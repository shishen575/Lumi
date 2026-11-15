/**
 * 株: 架空の会社の株価が、一定の時間(既定15分)ごとに、少しずつ動く。通貨で売り買いして、儲けたり、損したりする。
 * 株価は、「サーバー・会社・何回目の時刻か」から決まる乱数で動くので、タイマーが要らない(再起動しても、同じ値になる)。
 * 会社の名前・ティッカー・絵文字は、サーバーごとに変えられる
 */
// 変動の10段階: 段階ごとの、15分あたりの値動きの大きさ(1が静か、10が荒い)。1日の値動きの目安は、約 1.5% / 2.5% / 3.5% / 5% / 7% / 9% / 12% / 16% / 21% / 28%
export const VOL_LEVELS = [0.0015, 0.0026, 0.0036, 0.0051, 0.0071, 0.0092, 0.0122, 0.0163, 0.0214, 0.0286];
export const VOL_LABELS = ['とても静か', '静か', 'やや静か', '穏やか', 'ふつう', 'やや荒い', '荒い', 'とても荒い', '激しい', '暴れ馬'];
export const COMPANIES = [
  { id: 'c1', ticker: 'LUMI', name: 'ルミ電機', emoji: '⚡', base: 1000, level: 3, drift: 0.0002, blurb: '堅実な老舗' },
  { id: 'c2', ticker: 'MEN', name: 'ラーメン一番', emoji: '🍜', base: 500, level: 5, drift: 0.0000, blurb: '人気のチェーン' },
  { id: 'c3', ticker: 'PET', name: 'ペットワールド', emoji: '🐾', base: 800, level: 6, drift: 0.0001, blurb: '成長中の会社' },
  { id: 'c4', ticker: 'GEM', name: 'きらめきジュエル', emoji: '💎', base: 2000, level: 7, drift: 0.0000, blurb: '高級品を扱う' },
  { id: 'c5', ticker: 'YAMI', name: '闇市商事', emoji: '🕶️', base: 300, level: 9, drift: -0.0001, blurb: '怪しい会社' },
];
export const DEFAULT_LEVELS = Object.fromEntries(COMPANIES.map((c) => [c.id, c.level]));
export const sanitizeLevels = (input, current = DEFAULT_LEVELS) => Object.fromEntries(COMPANIES.map((c) => {
  const n = Math.round(Number(input?.[c.id])); return [c.id, Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : (current?.[c.id] ?? c.level)];
}));
export const DEFAULT_NAMES = Object.fromEntries(COMPANIES.map((c) => [c.id, { name: c.name, ticker: c.ticker, emoji: c.emoji }]));
export const MAX_TICK_STEPS = 2100;     // 長く見ていなかったときに、一度に計算する、最大の回数(5分ごとなら、7日ぶん)
export const KEEP_MINUTES = 7 * 1440;   // 履歴を残す期間(7日)
export const BASE_STEP = 15;           // 値動きの大きさの基準にする、間隔(分)
const REVERT = 0.02;                    // 平均への戻り(基準の価格から離れすぎないようにする)

/** 会社の名前・ティッカー・絵文字を、正しい形に直す(不正な入力は、いまの値のまま) */
export function sanitizeNames(input, current = DEFAULT_NAMES) {
  const out = {};
  for (const c of COMPANIES) {
    const cur = current?.[c.id] ?? DEFAULT_NAMES[c.id], v = input?.[c.id] ?? {};
    const clean = (x) => String(x ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim();
    const name = clean(v.name).slice(0, 16) || cur.name;
    const ticker = clean(v.ticker).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const emoji = [...clean(v.emoji)].slice(0, 2).join('') || cur.emoji;
    out[c.id] = { name, ticker: ticker.length >= 2 ? ticker : cur.ticker, emoji };
  }
  return out;
}
export const companyOf = (s, c) => ({ ...c, ...(s.stockNames?.[c.id] ?? {}) });

// 決まった乱数(同じ入力なら、いつも同じ値)
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-12, r()))) * Math.cos(2 * Math.PI * r());

export const NEWS_UP = ['新商品が大ヒット!', '好決算を発表', '大型契約を獲得', '人気の経営者が、就任'];
export const NEWS_DOWN = ['不祥事が発覚', '工場でトラブルが発生', '決算が、予想を下回った', 'ライバルに、顧客を奪われた'];
/** その時刻(tick)の、ニュース(なければ null): 確率 3% で、株価が大きく動く */
export function eventAt(guild, companyId, tick, stepFactor = 1, newsRate = 1) {
  const r = mulberry(hash(`ev:${guild}:${companyId}:${tick}`));
  if (r() >= 0.015 * stepFactor * newsRate) return null; // 15分あたり 1.5%(1日に1〜2回ほど)。間隔が短ければ、1回あたりは、その割合で小さく
  const up = r() < 0.5, size = 0.04 + r() * 0.06; // 基本の大きさ(±4〜10%)。荒い株ほど、大きく動く(nextPrice で調整)
  const list = up ? NEWS_UP : NEWS_DOWN;
  return { up, size, text: list[Math.floor(r() * list.length)] };
}
/**
 * 1つ前の価格から、次の時刻の価格を決める。
 *   level: 変動の10段階(1〜10)/ volScale: サーバー全体の倍率 / stepFactor: 更新間隔 ÷ 15分(間隔が短いほど、1回の動きは小さい)
 */
export function nextPrice(guild, c, tick, prev, { level = c.level, volScale = 1, stepFactor = 1, newsRate = 1 } = {}) {
  const vol = VOL_LEVELS[Math.min(10, Math.max(1, level)) - 1] * volScale;
  const r = mulberry(hash(`px:${guild}:${c.id}:${tick}`));
  let ret = (c.drift - REVERT * Math.log(prev / c.base)) * stepFactor + vol * Math.sqrt(stepFactor) * gauss(r);
  const ev = eventAt(guild, c.id, tick, stepFactor, newsRate);
  if (ev) ret += (ev.up ? 1 : -1) * ev.size * Math.min(2.5, Math.max(0.4, Math.sqrt(vol / VOL_LEVELS[4]))); // 荒い株ほど、ニュースで大きく動く
  return Math.min(c.base * 6, Math.max(c.base * 0.15, prev * Math.exp(ret)));
}
/**
 * 1つ後の価格から、1つ前の時刻の価格を、さかのぼって決める(履歴が24時間に足りないときに、過去のぶんを作る)。
 * 同じ乱数(その時刻の動き)を使い、逆向きに戻すので、いまの価格とつながる。ほぼ正確(平均への戻りの小さな項は、無視する)
 */
export function prevPrice(guild, c, tick, price, { level = c.level, volScale = 1, stepFactor = 1, newsRate = 1 } = {}) {
  const vol = VOL_LEVELS[Math.min(10, Math.max(1, level)) - 1] * volScale;
  const r = mulberry(hash(`px:${guild}:${c.id}:${tick}`));
  let ret = vol * Math.sqrt(stepFactor) * gauss(r);
  const ev = eventAt(guild, c.id, tick, stepFactor, newsRate);
  if (ev) ret += (ev.up ? 1 : -1) * ev.size * Math.min(2.5, Math.max(0.4, Math.sqrt(vol / VOL_LEVELS[4])));
  return Math.min(c.base * 6, Math.max(c.base * 0.15, price / Math.exp(ret)));
}
/** 上がった・下がった・変わらない、の矢印(上がったら 🔺、下がったら 🔻) */
export const trendArrow = (change) => (change > 0.0005 ? '🔺' : change < -0.0005 ? '🔻' : '➖');
export const tickOf = (now, tickMs) => Math.floor(now / tickMs);
