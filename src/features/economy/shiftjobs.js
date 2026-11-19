import { pick } from './games.js';

/**
 * ギミックつきのバイト(ミニゲーム): 配達員・スーパーのレジ・ケーキ屋・バリスタ。ラーメン屋と同じ形で、注文(お仕事)ごとに「ギミック」(仕掛け)がある。
 * 問題をボタンで答えて、出来栄えで給料が変わる。ギミックの種類(effect):
 *   speed  … 早く終えるほど、チップが増える(満点・成功のとき)
 *   strict … 1問でも間違えると、「まあまあ」止まり
 *   extra  … 問題が1つ増える(むずかしいが、満点のボーナスは、同じ)
 *   bonus  … おまけの問題が1つつく。完璧に答えると、チップ(間違えても、減らない)
 */
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const yen = (n) => `${n.toLocaleString()}円`;
/** 数の選択肢(正解を含む4つ)。near() で、まぎらわしい数を作る */
function nums(rng, answer, near, fmt = (n) => String(n)) {
  const set = new Set([answer]);
  for (let g = 0; set.size < 4 && g < 200; g++) { const v = near(); if (v > 0 && v !== answer) set.add(v); }
  for (let v = answer + 1; set.size < 4; v++) set.add(v);
  return shuffle(rng, [...set]).map((v) => ({ v, label: fmt(v) }));
}
const numStep = (rng, kind, prompt, answer, near, fmt, extra = {}) => { const o = nums(rng, answer, near, fmt); return { kind, prompt, options: o.map((x) => x.label), answer: o.findIndex((x) => x.v === answer), ...extra }; };
const textStep = (rng, kind, prompt, right, wrongs, extra = {}) => { const o = shuffle(rng, [right, ...shuffle(rng, wrongs).slice(0, 3)]); return { kind, prompt, options: o, answer: o.indexOf(right), ...extra }; };
const delta = (rng, list) => pick(rng, list);

/* ---------- 🚚 配達員 ---------- */
const TOWNS = ['桜町', '緑ヶ丘', '港南', '星見台', '白石', '青葉台', '朝日町', '松風町'];
const deliverySteps = (rng, V) => {
  const towns = shuffle(rng, TOWNS), n = ri(rng, 1, 5), target = `${towns[0]} ${n}丁目`;
  const steps = [textStep(rng, 'address', `📦 荷物の宛名: **${target}**。どの伝票?`, target, towns.slice(1).map((t, k) => `${t} ${((n + k) % 5) + 1}丁目`).filter((x) => x !== target).concat(`${towns[1]} ${n}丁目`))];
  const order = towns.slice(2, 5), last = order[2];
  steps.push(textStep(rng, 'load', `🚚 配達順は **${order.join(' → ')}**。後で降ろすものを、奥に積みます。**いちばん最初に積む**のは?`, `${last}行き`, order.slice(0, 2).map((t) => `${t}行き`).concat('どれでもよい')));
  const price = ri(rng, 5, 30) * 100, fee = ri(rng, 2, 8) * 100, paid = Math.ceil((price + fee + 1) / 1000) * 1000;
  steps.push(numStep(rng, 'change', `💴 代金引換: 商品 **${yen(price)}** + 送料 **${yen(fee)}**。お客さんは **${yen(paid)}** を出した。お釣りは?`, paid - price - fee, () => paid - price - fee + delta(rng, [-200, -100, 100, 200, 300]), yen));
  if (V.id === 'rain') steps.push(textStep(rng, 'wrap', '☔ **雨**: 荷物が濡れないように、何で包む?', 'ビニール袋(二重)', ['ティッシュ', '新聞紙', 'ふきん', '薄い紙袋']));
  if (V.id === 'highrise') { const k = ri(rng, 5, 11), ans = Math.ceil(k / 2); steps.push(numStep(rng, 'stairs', `🏢 **エレベーター故障**: 荷物が **${k}個**。階段で、1回に **2個**まで運べる。何往復?`, ans, () => ans + delta(rng, [-2, -1, 1, 2, 3]), (v) => `${v}往復`)); }
  if (V.id === 'frozen') { const k = ri(rng, 2, 6), ans = k * 2; steps.push(numStep(rng, 'ice', `🧊 **クール便**: 荷物が **${k}個**。1個につき、保冷剤が **2個**。保冷剤は、全部で?`, ans, () => ans + delta(rng, [-4, -2, 2, 4, 6]), (v) => `${v}個`)); }
  return steps;
};

/* ---------- 🛒 スーパーのレジ ---------- */
const GOODS = [['牛乳', 180], ['食パン', 150], ['たまご', 250], ['ヨーグルト', 120], ['バナナ', 200], ['納豆', 100], ['トマト', 300], ['お茶', 140]];
const registerSteps = (rng, V) => {
  const items = shuffle(rng, GOODS).slice(0, 3), sum = items.reduce((a, [, p]) => a + p, 0);
  const steps = [numStep(rng, 'sum', `🧾 **${items.map(([n, p]) => `${n} ${yen(p)}`).join(' / ')}**。合計は?`, sum, () => sum + delta(rng, [-100, -50, -20, 20, 50, 100]), yen)];
  const paid = Math.ceil((sum + 1) / 500) * 500;
  steps.push(numStep(rng, 'change', `💴 お客さんは **${yen(paid)}** を出した。お釣りは?(合計 ${yen(sum)})`, paid - sum, () => paid - sum + delta(rng, [-100, -50, 50, 100, 150]), yen));
  if (V.id === 'coupon') { const off = pick(rng, [10, 20, 30]), base = ri(rng, 3, 9) * 100, ans = base * (100 - off) / 100; steps.push(numStep(rng, 'coupon', `🎟️ **クーポン**: **${yen(base)}** の品が **${off}%引き**。いくら?`, ans, () => ans + delta(rng, [-60, -30, 30, 60, 90]), yen)); }
  if (V.id === 'tax') { const food = ri(rng, 2, 6) * 100, goods = ri(rng, 2, 6) * 100, ans = Math.round(food * 1.08 + goods * 1.1); steps.push(numStep(rng, 'tax', `🧾 **軽減税率**: 食品 **${yen(food)}**(税 8%)+ 日用品 **${yen(goods)}**(税 10%)。税込みの合計は?(四捨五入)`, ans, () => ans + delta(rng, [-30, -10, 10, 30, 50]), yen)); }
  if (V.id === 'points') { const m = pick(rng, [2, 3, 5]), amt = ri(rng, 3, 9) * 100, ans = amt / 100 * m; steps.push(numStep(rng, 'points', `⭐ **ポイント${m}倍デー**: 100円で 1ポイント。**${yen(amt)}** の買い物で、何ポイント?`, ans, () => ans + delta(rng, [-3, -2, 2, 3, 5]), (v) => `${v}ポイント`, { bonus: true })); }
  return steps;
};

/* ---------- 🍰 ケーキ屋 ---------- */
const FLAVORS = ['いちご', 'チョコ', 'レモン', 'モンブラン', 'チーズ', 'ティラミス'];
const WORDS = ['おめでとう', 'ありがとう', 'ごけっこん', 'おたんじょうび'];
const NAMES = ['さくら', 'はると', 'みなみ', 'ゆうたろう', 'あおい'];
const cakeSteps = (rng, V) => {
  const fl = shuffle(rng, FLAVORS), want = fl[0], steps = [textStep(rng, 'flavor', `📋 注文: **${want}** のケーキ。どのスポンジ・クリーム?`, `${want}味`, fl.slice(1).map((x) => `${x}味`))];
  const age = ri(rng, 12, 59), big = Math.floor(age / 10), small = age % 10, right = `太${big}本・細${small}本`;
  const wrongs = [`太${small}本・細${big}本`, `太${big + 1}本・細${small}本`, `太${big}本・細${(small + 1) % 10}本`, `太${Math.max(0, big - 1)}本・細${small}本`].filter((x) => x !== right);
  steps.push(textStep(rng, 'candles', `🕯️ お客さんは **${age}歳**。太いろうそく(10歳)と細いろうそく(1歳)を、組み合わせる。どれ?`, right, wrongs));
  const k = ri(rng, 4, 10), per = ri(rng, 2, 4), ans = k * per;
  steps.push(numStep(rng, 'berries', `🍓 **${k}個**のカップケーキに、1個につき ${per}個のいちごを乗せる。いちごは全部で?`, ans, () => ans + delta(rng, [-4, -2, 2, 3, 5]), (v) => `${v}個`));
  if (V.id === 'birthday') { const w = pick(rng, WORDS), nm = pick(rng, NAMES), ans2 = [...w].length + [...nm].length; steps.push(numStep(rng, 'plate', `🍫 **プレート**に「${w}」と、名前「${nm}」を書く。文字は、全部で何文字?`, ans2, () => ans2 + delta(rng, [-2, -1, 1, 2, 3]), (v) => `${v}文字`, { bonus: true })); }
  if (V.id === 'party') { const people = ri(rng, 9, 22), ans2 = Math.ceil(people / 8); steps.push(numStep(rng, 'cut', `🎉 **大量注文**: **${people}人**で食べる。ホール1個は **8等分**。ホールは、何個いる?`, ans2, () => ans2 + delta(rng, [-1, 1, 2]), (v) => `${v}個`)); }
  return steps;
};

/* ---------- ☕ バリスタ ---------- */
const DRINKS = [['ラテ', 1, 3], ['カプチーノ', 1, 2], ['フラットホワイト', 1, 2], ['カフェオレ', 1, 4]];
const cafeSteps = (rng, V) => {
  const dr = shuffle(rng, DRINKS), [name, e, m] = dr[0], unit = e + m, total = unit * 10 * ri(rng, 1, 5); // 全量は、割合の合計(unit)の倍数にする(割り切れる。端数も、四捨五入も、出さない)
  const per = total / unit * m;
  const cand = [...new Set([...dr.slice(1).map((d) => `${d[1]}:${d[2]}`), `${m}:${e}`, `${e}:${m + 2}`, `${e + 1}:${m}`, `${e}:${m + 1}`])].filter((x) => x !== `${e}:${m}`);
  const steps = [textStep(rng, 'drink', `📋 注文: **${name}**(エスプレッソ ${e} : ミルク ${m})。どのレシピ?`, `${e}:${m}`, cand)];
  steps.push(numStep(rng, 'ratio', `🥛 **${name}**を **${total}ml** 作る(エスプレッソ ${e} : ミルク ${m})。ミルクは何ml?`, per, () => per + delta(rng, [-40, -20, -10, 10, 20, 40]), (v) => `${v}ml`));
  const now = pick(rng, [10, 20, 25]), ans = (65 - now) / 5, ansMin = ans;
  steps.push(numStep(rng, 'steam', `🔥 ミルクを **65℃** まで温める。いま **${now}℃**、スチームで **1分に 5℃** 上がる。何分?`, ansMin, () => ansMin + delta(rng, [-3, -2, 2, 3, 5]), (v) => `${v}分`));
  if (V.id === 'iced') { const cups = ri(rng, 2, 5), g = ri(rng, 3, 6) * 10, ans2 = cups * g; steps.push(numStep(rng, 'ice', `🧊 **アイス**: カップ **${cups}個**。1個に氷 **${g}g**。氷は全部で?`, ans2, () => ans2 + delta(rng, [-30, -20, 20, 30, 40]), (v) => `${v}g`)); }
  if (V.id === 'seasonal') { const sy = ri(rng, 2, 5), cups = ri(rng, 3, 6), ans2 = sy * cups; steps.push(numStep(rng, 'syrup', `🍂 **季節限定**: シロップ **${sy}g** を、**${cups}杯**。全部で何g?`, ans2, () => ans2 + delta(rng, [-3, -2, 2, 3, 5]), (v) => `${v}g`, { bonus: true })); }
  return steps;
};

/* ---------- 一覧 ---------- */
export const SHIFT_GAMES = {
  delivery: { title: '配達員のバイト', emoji: '🚚', build: deliverySteps, variants: {
    rain: { id: 'rain', name: '雨の日の配達', emoji: '☔', gimmick: '☔ 雨', gimmickText: '荷物が濡れないように、包み方の問題が1つ増えます', effect: 'extra' },
    rush: { id: 'rush', name: '時間指定便', emoji: '⏰', gimmick: '⏰ 時間指定', gimmickText: '早く届けるほど、チップが増えます', effect: 'speed' },
    highrise: { id: 'highrise', name: '高層マンション', emoji: '🏢', gimmick: '🏢 エレベーター故障', gimmickText: '階段の往復を数える問題が、1つ増えます', effect: 'extra' },
    frozen: { id: 'frozen', name: 'クール便', emoji: '🧊', gimmick: '🧊 繊細', gimmickText: '保冷剤を数える問題が増えて、1問でも間違えると、「まあまあ」止まり', effect: 'strict' } } },
  register: { title: 'スーパーのレジのバイト', emoji: '🛒', build: registerSteps, variants: {
    coupon: { id: 'coupon', name: 'クーポンデー', emoji: '🎟️', gimmick: '🎟️ クーポン', gimmickText: '割引の計算が、1つ増えます', effect: 'extra' },
    rush: { id: 'rush', name: '夕方のレジ行列', emoji: '🏃', gimmick: '🏃 行列', gimmickText: '早くさばくほど、チップが増えます', effect: 'speed' },
    tax: { id: 'tax', name: '軽減税率', emoji: '🧾', gimmick: '🧾 税率ちがい', gimmickText: '食品 8%・日用品 10% の計算が増えて、1問でも間違えると、「まあまあ」止まり', effect: 'strict' },
    points: { id: 'points', name: 'ポイント倍デー', emoji: '⭐', gimmick: '⭐ ポイント', gimmickText: 'ポイントの計算が、おまけでつきます。完璧に答えると、チップ', effect: 'bonus' } } },
  cake: { title: 'ケーキ屋のバイト', emoji: '🍰', build: cakeSteps, variants: {
    birthday: { id: 'birthday', name: 'バースデーケーキ', emoji: '🎂', gimmick: '🎂 プレート', gimmickText: 'プレートの文字数が、おまけでつきます。完璧に答えると、チップ', effect: 'bonus' },
    wedding: { id: 'wedding', name: 'ウェディングケーキ', emoji: '💒', gimmick: '💒 繊細', gimmickText: '1問でも間違えると、「まあまあ」止まり', effect: 'strict' },
    summer: { id: 'summer', name: '真夏のケーキ', emoji: '☀️', gimmick: '☀️ 溶ける', gimmickText: 'クリームが溶ける前に! 早く仕上げるほど、チップが増えます', effect: 'speed' },
    party: { id: 'party', name: 'パーティーの大量注文', emoji: '🎉', gimmick: '🎉 大量注文', gimmickText: '必要なホールの数を数える問題が、1つ増えます', effect: 'extra' } } },
  cafe: { title: 'バリスタのバイト', emoji: '☕', build: cafeSteps, variants: {
    latteart: { id: 'latteart', name: 'ラテアート', emoji: '🎨', gimmick: '🎨 繊細', gimmickText: '1問でも間違えると、「まあまあ」止まり', effect: 'strict' },
    iced: { id: 'iced', name: 'アイスドリンク', emoji: '🧊', gimmick: '🧊 氷', gimmickText: '氷の量を数える問題が、1つ増えます', effect: 'extra' },
    morning: { id: 'morning', name: 'モーニングの行列', emoji: '🚶', gimmick: '🚶 行列', gimmickText: '早く出すほど、チップが増えます', effect: 'speed' },
    seasonal: { id: 'seasonal', name: '季節限定ドリンク', emoji: '🍂', gimmick: '🍂 限定シロップ', gimmickText: 'シロップの計算が、おまけでつきます。完璧に答えると、チップ', effect: 'bonus' } } },
};
export const isShiftGame = (k) => k in SHIFT_GAMES;
/** 注文(お仕事)を作る */
export function makeShift(game, rng = Math.random, variantId = null) {
  const G = SHIFT_GAMES[game], V = G.variants[variantId] ?? pick(rng, Object.values(G.variants));
  return { game, type: V.id, steps: G.build(rng, V) };
}
export const variantOf = (game, type) => SHIFT_GAMES[game]?.variants[type];

export const SHIFT_GRADES = {
  perfect: { label: '大成功!', mult: 1, color: 'gold' }, good: { label: '成功', mult: 0.7, color: 'green' },
  soso: { label: 'まあまあ', mult: 0.4, color: 'gray' }, bad: { label: '失敗…', mult: 0.1, color: 'red' },
};
/** 出来栄えの評価と、給料。cfg: { perfectBonus(%), speedBonus(%), bonusStep(%), timeMs } */
export function gradeShift(order, results, base, remainingMs, cfg) {
  const V = variantOf(order.game, order.type);
  const main = order.steps.map((s, n) => ({ s, ok: !!results[n] })).filter((x) => !x.s.bonus);
  const right = main.filter((x) => x.ok).length, total = main.length;
  let grade = right === total ? 'perfect' : right / total >= 0.66 ? 'good' : right / total >= 0.33 ? 'soso' : 'bad';
  if (V.effect === 'strict' && right < total && (grade === 'perfect' || grade === 'good')) grade = 'soso';
  let pct = SHIFT_GRADES[grade].mult * 100; const notes = [];
  if (grade === 'perfect') { pct += cfg.perfectBonus; notes.push(`満点ボーナス +${cfg.perfectBonus}%`); }
  if (V.effect === 'speed' && (grade === 'perfect' || grade === 'good')) { const b = Math.round(cfg.speedBonus * Math.max(0, Math.min(1, remainingMs / cfg.timeMs))); if (b > 0) { pct += b; notes.push(`早く終えた! +${b}%`); } }
  const bi = order.steps.findIndex((s) => s.bonus);
  if (bi >= 0 && results[bi]) { pct += cfg.bonusStep; notes.push(`おまけも完璧! +${cfg.bonusStep}%`); }
  return { grade, right, total, amount: Math.round(base * pct / 100), notes };
}
