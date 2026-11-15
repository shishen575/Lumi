/**
 * 株: 架空の会社の株価が、一定の時間(既定15分)ごとに、少しずつ動く。通貨で売り買いして、儲けたり、損したりする。
 * 株価は、「サーバー・会社・何回目の時刻か」から決まる乱数で動くので、タイマーが要らない(再起動しても、同じ値になる)。
 * 会社の名前・ティッカー・絵文字は、サーバーごとに変えられる
 */
export const COMPANIES = [
  { id: 'c1', ticker: 'LUMI', name: 'ルミ電機', emoji: '⚡', base: 1000, vol: 0.010, drift: 0.0002, blurb: '堅実な老舗。値動きは小さい' },
  { id: 'c2', ticker: 'MEN', name: 'ラーメン一番', emoji: '🍜', base: 500, vol: 0.020, drift: 0.0000, blurb: '人気のチェーン。ふつうの値動き' },
  { id: 'c3', ticker: 'PET', name: 'ペットワールド', emoji: '🐾', base: 800, vol: 0.025, drift: 0.0001, blurb: '成長中。やや荒い値動き' },
  { id: 'c4', ticker: 'GEM', name: 'きらめきジュエル', emoji: '💎', base: 2000, vol: 0.030, drift: 0.0000, blurb: '高級品。上下が大きい' },
  { id: 'c5', ticker: 'YAMI', name: '闇市商事', emoji: '🕶️', base: 300, vol: 0.045, drift: -0.0001, blurb: '怪しい会社。ハイリスク・ハイリターン' },
];
export const DEFAULT_NAMES = Object.fromEntries(COMPANIES.map((c) => [c.id, { name: c.name, ticker: c.ticker, emoji: c.emoji }]));
export const MAX_TICK_STEPS = 600;      // 長く見ていなかったときに、一度に計算する、最大の回数
export const KEEP_TICKS = 96 * 7;       // 履歴を残す期間(15分ごとなら、7日)
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
export function eventAt(guild, companyId, tick) {
  const r = mulberry(hash(`ev:${guild}:${companyId}:${tick}`));
  if (r() >= 0.03) return null;
  const up = r() < 0.5, size = 0.10 + r() * 0.15;
  const list = up ? NEWS_UP : NEWS_DOWN;
  return { up, size, text: list[Math.floor(r() * list.length)] };
}
/** 1つ前の価格から、次の時刻の価格を決める(volScale: 値動きの大きさの倍率) */
export function nextPrice(guild, c, tick, prev, volScale = 1) {
  const r = mulberry(hash(`px:${guild}:${c.id}:${tick}`));
  let ret = c.drift - REVERT * Math.log(prev / c.base) + c.vol * volScale * gauss(r);
  const ev = eventAt(guild, c.id, tick); if (ev) ret += (ev.up ? 1 : -1) * ev.size;
  return Math.min(c.base * 6, Math.max(c.base * 0.15, prev * Math.exp(ret)));
}
export const tickOf = (now, tickMs) => Math.floor(now / tickMs);
