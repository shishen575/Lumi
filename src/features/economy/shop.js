import { FX, describeFx } from './effects.js';

/**
 * お店: 買って `/use` で使うと、しばらくの間、効果(良いことと、代償)がつく。
 * 品は、サーバーごとに、ダッシュボードで自由に変えられる(名前・絵文字・値段・時間・効果・説明、追加・削除も)。
 * 同じ「枠」(タバコ・お酒・その他)の品は、同時に1つだけ効く(もう一度使うと、上書き)。別の枠は、同時に効く
 */
export const SLOTS = { tobacco: 'タバコ', alcohol: 'お酒', other: 'その他' };
export const MAX_SHOP_ITEMS = 12;
export const SHOP_MAX_STACK = 99;
export const DEFAULT_SHOP = [
  { id: 'shop_tobacco', slot: 'tobacco', name: 'タバコ', emoji: '🚬', price: 80, minutes: 15, effects: { crimeChance: 0.03, ramenTime: 0.2, workPay: -0.1 }, desc: '一服して集中。ヤニで、バイトの給料が少し下がる' },
  { id: 'shop_beer', slot: 'alcohol', name: 'ビール', emoji: '🍺', price: 120, minutes: 20, effects: { crimeChance: 0.05, heistTime: -0.1, arrestChance: 0.05 }, desc: 'ほろ酔いで、気が大きくなる。判断が鈍って、大型犯罪の時間が短く感じる' },
  { id: 'shop_wine', slot: 'alcohol', name: 'ワイン', emoji: '🍷', price: 300, minutes: 30, effects: { begAmount: 0.3, crimeChance: -0.02 }, desc: '上機嫌で、愛想が良くなる。ただし、悪事は、少し苦手になる' },
  { id: 'shop_whisky', slot: 'alcohol', name: 'ウイスキー', emoji: '🥃', price: 500, minutes: 30, effects: { crimeChance: 0.1, fineMult: 0.5, heistMistakes: -1, arrestChance: 0.1 }, desc: '泥酔で、怖いものなし。失敗すると、罰金が重く、大型犯罪では、ミスが許されない' },
  { id: 'shop_disguise', slot: 'other', name: '変装セット', emoji: '🕶️', price: 400, minutes: 30, effects: { arrestChance: -0.15, workPay: -0.05 }, desc: '帽子とサングラスで、別人のふり。警察に、見つかりにくい(動きにくくて、バイトの給料が少し下がる)' },
  { id: 'shop_badge', slot: 'other', name: '警察バッジ', emoji: '🏅', price: 600, minutes: 30, effects: { arrestSuccess: 0.15, arrestReward: 0.2 }, desc: '本物そっくりのバッジ。逮捕しやすくなり、報酬も増える' },
  { id: 'shop_lawyer', slot: 'other', name: '弁護士の名刺', emoji: '⚖️', price: 500, minutes: 30, effects: { arrestFine: -0.5 }, desc: '捕まっても、腕利きの弁護士が付く。逮捕されたときの罰金が、半分になる' },
];

// 効果の値の、許す範囲(足し算の値。0.05 = +5%)
const RANGE = { crimeChance: [-0.5, 0.5], workPay: [-0.9, 3], begAmount: [-0.9, 3], heistTime: [-0.9, 2], ramenTime: [-0.9, 2], heistMistakes: [-5, 5], fineMult: [-0.9, 5], toolKeep: [-1, 1], arrestChance: [-0.5, 0.5], arrestFine: [-1, 5], arrestSuccess: [-0.5, 0.5], arrestReward: [-0.9, 5] };
const clean = (x, n) => String(x ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, n);
const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
export function sanitizeEffects(input) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RANGE)) {
    const raw = input?.[k]; if (raw === undefined || raw === null || raw === '') continue;
    let v = num(raw, lo, hi, 0); v = k === 'heistMistakes' ? Math.round(v) : Math.round(v * 1000) / 1000;
    if (v !== 0) out[k] = v;
  }
  return out;
}
/** 品のリストを、正しい形に直す(最大12品・名前・値段・効果の範囲など)。空のリストや不正な入力は、いまの品のまま */
export function sanitizeShopItems(input, current = DEFAULT_SHOP) {
  if (!Array.isArray(input)) return current;
  const used = new Set(), out = [];
  for (const raw of input.filter((x) => clean(x?.name, 12)).slice(0, MAX_SHOP_ITEMS)) { // 名前が空のものは捨ててから、最大12品
    const name = clean(raw?.name, 12);
    let id = /^shop_[a-z0-9]{1,12}$/.test(String(raw?.id ?? '')) ? raw.id : null;
    if (!id || used.has(id)) { let n = 1; while (used.has(`shop_n${n}`) || out.some((x) => x.id === `shop_n${n}`)) n++; id = `shop_n${n}`; }
    used.add(id);
    out.push({
      id, slot: SLOTS[raw?.slot] ? raw.slot : 'other', name, emoji: [...clean(raw?.emoji, 8)].slice(0, 2).join('') || '🛍️',
      price: Math.round(num(raw?.price, 1, 1e9, 100)), minutes: Math.round(num(raw?.minutes, 1, 1440, 15)),
      effects: sanitizeEffects(raw?.effects), desc: clean(raw?.desc, 60),
    });
  }
  return out.length ? out : current;
}
export const shopItems = (s) => s.shopItems ?? DEFAULT_SHOP;
export const shopById = (s, id) => shopItems(s).find((x) => x.id === id) ?? null;
export const itemFx = (item) => ({ ...item.effects });
// 良いこと(成功率アップなど)と、代償(罰金が増えるなど)に分けて見せる
const isDrawback = (k, v) => (k === 'fineMult' || k === 'arrestChance' || k === 'arrestFine' ? v > 0 : v < 0); // 罰金・逮捕される確率は、増えるのが代償
export const itemText = (item) => {
  const good = {}, bad = {};
  for (const [k, v] of Object.entries(item.effects ?? {})) (isDrawback(k, v) ? bad : good)[k] = v;
  return `${describeFx(good) || '(効果なし)'}${Object.keys(bad).length ? ` ／ 代償: ${describeFx(bad)}` : ''}`;
};
export const FX_LABELS = Object.fromEntries(Object.entries(FX).map(([k, v]) => [k, { label: v.label, kind: v.kind }]));
