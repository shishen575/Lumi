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

// ニュース(出来事): 株価が、決まった割合で、上がったり、下がったりする。サーバーごとに、ダッシュボードで、自由に変えられる
// pct: 株価の変わる割合(%。プラスは上がる、マイナスは下がる)/ company: 空なら全社、会社の id ならその会社だけ / weight: 起きやすさ(1〜10)
export const MAX_EVENTS = 120;
const E = (id, pct, text, company = '', weight = 3) => ({ id, enabled: true, text, pct, company, weight });
export const DEFAULT_EVENTS = [
  // ---- いい出来事(全部の会社)。いい・悪いの合計が、片寄らないように、数字を整えてある ----
  E('ev_up1', 9, '新商品が、大ヒット!'), E('ev_up2', 7, '好決算を発表'), E('ev_up3', 10, '大型契約を獲得'), E('ev_up4', 6, '人気の経営者が、就任'),
  E('ev_up5', 11, '大手企業との提携を発表'), E('ev_up6', 6, '増配を発表'), E('ev_up7', 7, '新しい工場が、稼働'), E('ev_up8', 4, '業界全体に、追い風', '', 2),
  E('ev_g01', 10, '画期的な特許を、取得'), E('ev_g02', 8, '自社株買いを、発表'), E('ev_g03', 11, '赤字から、黒字に転換'), E('ev_g04', 9, '海外に、本格進出'),
  E('ev_g05', 4, '業界の大きな賞を、受賞'), E('ev_g06', 7, 'AIの導入で、大幅に効率化'), E('ev_g07', 6, '株主優待を、新設'), E('ev_g08', 7, '格付けが、引き上げられた'),
  E('ev_g09', 8, '有名人が、愛用していると話題に'), E('ev_g10', 6, 'SNSで、好意的な口コミが拡散'), E('ev_g11', 9, '買収の噂で、注目が集まる', '', 2), E('ev_g12', 7, '大口の注文が、相次ぐ'),
  E('ev_g13', 10, '主力商品が、品薄になる大人気', '', 2), E('ev_g14', 6, '経費削減が、成功'), E('ev_g15', 8, '新しい市場に、参入して成功'), E('ev_g16', 4, '従業員の満足度が、業界トップに'),
  // ---- 悪い出来事・不祥事(全部の会社) ----
  E('ev_dn1', -7, '不祥事が、発覚'), E('ev_dn2', -5, '工場でトラブルが、発生'), E('ev_dn3', -4, '決算が、予想を下回った'), E('ev_dn4', -4, 'ライバルに、顧客を奪われた'),
  E('ev_dn5', -9, '商品の、リコールが発生'), E('ev_dn6', -6, '社長が、急病で入院'), E('ev_dn7', -4, 'ストライキが、発生'), E('ev_dn8', -8, 'サイバー攻撃を、受けた', '', 2),
  E('ev_b01', -14, '粉飾決算が、発覚', '', 1), E('ev_b02', -9, '顧客情報が、大量に流出'), E('ev_b03', -8, '幹部による、横領事件が発覚'), E('ev_b04', -6, 'パワハラの、内部告発'),
  E('ev_b05', -5, '税務調査が、入った'), E('ev_b06', -10, '株価操作の疑いで、調査を受ける', '', 1), E('ev_b07', -8, '主要な取引先が、取引を停止'), E('ev_b08', -4, '格付けが、引き下げられた'),
  E('ev_b09', -7, '大規模な、システム障害'), E('ev_b10', -10, '談合の疑いが、浮上', '', 1), E('ev_b11', -6, '誇大広告で、行政指導を受ける'), E('ev_b12', -5, '看板商品が、販売終了に'),
  E('ev_b13', -9, '内部告発で、不正が明らかに', '', 1), E('ev_b14', -8, '工場の閉鎖を、発表'), E('ev_b15', -4, '天候不順で、物流が大混乱'), E('ev_b16', -4, '為替の影響で、大幅な赤字'),
  E('ev_b17', -7, '社長の、不適切な発言が炎上'), E('ev_b18', -6, '品質データの、改ざんが発覚'), E('ev_b19', -8, '労働環境が、問題視される'), E('ev_b20', -5, '大口顧客が、競合に乗り換え'),
  E('ev_b21', -11, '不正会計の、疑いが報道される', '', 1), E('ev_b22', -4, '人気商品に、欠陥が見つかる'), E('ev_b23', -8, '元社員が、会社を告発'), E('ev_b24', -4, '決算発表を、延期'),
  // ---- 会社ごとの出来事 ----
  E('ev_c1a', -6, '発電所のトラブルで、大規模な停電', 'c1', 2), E('ev_c1b', -9, '製品の発火事故で、リコール', 'c1', 2), E('ev_c1c', -10, '検査データの、改ざんが発覚', 'c1', 1),
  E('ev_c1d', 10, '新型バッテリーの、開発に成功', 'c1', 2), E('ev_c1e', 9, '海外から、大型の受注', 'c1', 2), E('ev_c1f', 8, '省エネ家電が、大ヒット', 'c1', 2),
  E('ev_c2a', 10, '行列ができる、大人気に', 'c2', 2), E('ev_c2b', -11, '食中毒騒ぎが、発生', 'c2', 1), E('ev_c2c', -7, 'スープから、異物が見つかる', 'c2', 2),
  E('ev_c2d', -8, '産地の偽装が、発覚', 'c2', 1), E('ev_c2e', -5, 'アルバイトの悪ふざけ動画が、拡散', 'c2', 2), E('ev_c2f', 9, '人気評論家が、絶賛', 'c2', 2),
  E('ev_c2g', 8, '海外1号店が、大盛況', 'c2', 2), E('ev_c2h', -4, '値上げが、炎上', 'c2', 2),
  E('ev_c3a', 9, '新種のペットが、大ヒット', 'c3', 2), E('ev_c3b', -10, '動物の扱いに、虐待疑惑', 'c3', 1), E('ev_c3c', -6, 'ペットフードに、異物混入', 'c3', 2),
  E('ev_c3d', 10, '空前のペットブームが、到来', 'c3', 2), E('ev_c3e', 8, '人気インフルエンサーが、宣伝', 'c3', 2), E('ev_c3f', 7, '100号店を、オープン', 'c3', 2),
  E('ev_c4a', 11, '宝石の価格が、高騰', 'c4', 2), E('ev_c4b', -9, '偽ブランド品の、疑惑', 'c4', 1), E('ev_c4c', -8, '店舗で、盗難事件が発生', 'c4', 2),
  E('ev_c4d', 10, '大物俳優が着用して、完売', 'c4', 2), E('ev_c4e', -8, '産地の偽装が、発覚', 'c4', 1), E('ev_c4f', 8, '王室御用達に、選ばれる', 'c4', 1),
  E('ev_c5a', -15, '闇取引が、摘発された!', 'c5', 1), E('ev_c5b', 13, '裏で、大もうけの噂', 'c5', 1), E('ev_c5c', -10, '内部告発で、裏帳簿が明らかに', 'c5', 1),
  E('ev_c5d', 11, '大物のバックが、付いた', 'c5', 1), E('ev_c5e', -7, '税務調査で、追徴課税', 'c5', 2), E('ev_c5f', -12, '幹部が、逮捕された', 'c5', 1),
];
const evClean = (x, n) => String(x ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, n);
/** 出来事のリストを、正しい形に直す(最大40件。割合は ±1〜50%)。空のリストや不正な入力は、いまのまま(全部オフにするときは、各項目の「有効」をオフにする) */
export function sanitizeEvents(input, current = DEFAULT_EVENTS) {
  if (!Array.isArray(input)) return current;
  const out = [], used = new Set();
  for (const raw of input.filter((x) => evClean(x?.text, 30)).slice(0, MAX_EVENTS)) {
    const pct = Math.round(Number(raw?.pct)); if (!Number.isFinite(pct) || pct === 0) continue;
    let id = /^ev_[a-z0-9]{1,10}$/.test(String(raw?.id ?? '')) ? raw.id : null;
    if (!id || used.has(id)) { let n = 1; while (used.has(`ev_n${n}`)) n++; id = `ev_n${n}`; }
    used.add(id);
    out.push({ id, enabled: raw?.enabled !== false, text: evClean(raw.text, 30), pct: Math.max(-50, Math.min(50, pct)), company: COMPANIES.some((c) => c.id === raw?.company) ? raw.company : '', weight: Math.max(1, Math.min(10, Math.round(Number(raw?.weight)) || 3)) });
  }
  return out.length ? out : current;
}
export const DEFAULT_NEWS = { rate: 1, events: DEFAULT_EVENTS, every: 0, step: 5, power: 1 };
const pickEvent = (r, list) => { let x = r() * list.reduce((a, e) => a + e.weight, 0), e = list.at(-1); for (const c of list) { x -= c.weight; if (x < 0) { e = c; break; } } return e; };
const applicable = (events, companyId) => events.filter((e) => e.enabled && (!e.company || e.company === companyId));
/**
 * その時刻(tick。分)の、ニュース(なければ null)。news = { rate, events, every, step, power }
 *   every = 0: ランダム。確率 約1.5%(15分あたり)で、出来事が1つ起きる(rate で、起きやすさを変える)
 *   every = N: N分ごとに、ちょうど1つ、出来事が起きる(どの会社に起きるかは、毎回、決まった乱数で選ぶ)
 * どの出来事が起きるかは、起きやすさ(weight)で決まる。power は、株価の変わる割合に掛ける倍率(1 = 書いてある通り)
 */
export function eventAt(guild, companyId, tick, stepFactor = 1, news = DEFAULT_NEWS) {
  const events = news.events ?? DEFAULT_EVENTS; let e;
  if (news.every > 0) {
    const N = news.every, k = Math.floor(tick / N);
    if (k === Math.floor((tick - news.step) / N)) return null; // その区間の、最初の更新のときだけ
    const r = mulberry(hash(`nws:${guild}:${k}`)), ids = COMPANIES.map((c) => c.id).filter((id) => applicable(events, id).length);
    if (!ids.length || ids[Math.floor(r() * ids.length)] !== companyId) return null;
    e = pickEvent(r, applicable(events, companyId));
  } else {
    const r = mulberry(hash(`ev:${guild}:${companyId}:${tick}`));
    if (r() >= 0.015 * stepFactor * (news.rate ?? 1)) return null; // 15分あたり 1.5%(1日に1〜2回ほど)。間隔が短ければ、1回あたりは、その割合で小さく
    const list = applicable(events, companyId); if (!list.length) return null;
    e = pickEvent(r, list);
  }
  const pct = e.pct * (news.power ?? 1);
  return { id: e.id, up: e.pct > 0, pct, size: Math.abs(pct) / 100, text: e.text };
}
/**
 * 1つ前の価格から、次の時刻の価格を決める。
 *   level: 変動の10段階(1〜10)/ volScale: サーバー全体の倍率 / stepFactor: 更新間隔 ÷ 15分(間隔が短いほど、1回の動きは小さい)
 */
export function nextPrice(guild, c, tick, prev, { level = c.level, volScale = 1, stepFactor = 1, news = DEFAULT_NEWS } = {}) {
  const vol = VOL_LEVELS[Math.min(10, Math.max(1, level)) - 1] * volScale;
  const r = mulberry(hash(`px:${guild}:${c.id}:${tick}`));
  let ret = (c.drift - REVERT * Math.log(prev / c.base)) * stepFactor + vol * Math.sqrt(stepFactor) * gauss(r);
  const ev = eventAt(guild, c.id, tick, stepFactor, news);
  if (ev) ret += Math.log(1 + ev.pct / 100); // 出来事で、決まった割合だけ動く
  return Math.min(c.base * 6, Math.max(c.base * 0.15, prev * Math.exp(ret)));
}
/**
 * 1つ後の価格から、1つ前の時刻の価格を、さかのぼって決める(履歴が24時間に足りないときに、過去のぶんを作る)。
 * 同じ乱数(その時刻の動き)を使い、逆向きに戻すので、いまの価格とつながる。ほぼ正確(平均への戻りの小さな項は、無視する)
 */
export function prevPrice(guild, c, tick, price, { level = c.level, volScale = 1, stepFactor = 1, news = DEFAULT_NEWS } = {}) {
  const vol = VOL_LEVELS[Math.min(10, Math.max(1, level)) - 1] * volScale;
  const r = mulberry(hash(`px:${guild}:${c.id}:${tick}`));
  let ret = vol * Math.sqrt(stepFactor) * gauss(r);
  const ev = eventAt(guild, c.id, tick, stepFactor, news);
  if (ev) ret += Math.log(1 + ev.pct / 100); // 出来事で、決まった割合だけ動く
  return Math.min(c.base * 6, Math.max(c.base * 0.15, price / Math.exp(ret)));
}
/** 上がった・下がった・変わらない、の矢印(上がったら 🔺、下がったら 🔻) */
export const trendArrow = (change) => (change > 0.0005 ? '🔺' : change < -0.0005 ? '🔻' : '➖');
export const tickOf = (now, tickMs) => Math.floor(now / tickMs);
