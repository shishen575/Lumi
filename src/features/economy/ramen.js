import { pick } from './games.js';

/**
 * ラーメン屋のバイト(ミニゲーム): お客さんの注文に合わせて、スープ・麺の茹で時間・トッピングを、ボタンで選んで作る。
 * ラーメンの種類ごとに「ギミック」(仕掛け)がある。出来栄えで、給料が変わる
 */
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const shuffle = (rng, arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const RAMEN = {
  shoyu: { id: 'shoyu', name: '醤油ラーメン', emoji: '🍜', soup: '🟤 醤油ダレ', gimmick: '🏃 行列', gimmickText: '行列ができている! 早く出せるほど、チップが増えます' },
  miso: { id: 'miso', name: '味噌ラーメン', emoji: '🍲', soup: '🟠 味噌ダレ', gimmick: '🌡️ ふつふつ', gimmickText: '味噌は焦げやすい。火加減を合わせる問題が、1つ増えます' },
  tonkotsu: { id: 'tonkotsu', name: '豚骨ラーメン', emoji: '🐖', soup: '⚪ 豚骨', gimmick: '🍜 替え玉', gimmickText: '食べ終わったお客さんが「替え玉!」。最後に、おまけの1問(正解でチップ)' },
  shio: { id: 'shio', name: '塩ラーメン', emoji: '🧂', soup: '🟡 塩ダレ', gimmick: '🎯 繊細', gimmickText: '味がごまかせない。1問でも間違えると、「まあまあ」止まり' },
  spicy: { id: 'spicy', name: '激辛ラーメン', emoji: '🌶️', soup: '🔴 辛味噌', gimmick: '🔥 辛さ指定', gimmickText: '辛さの指定がある。唐辛子のグラム数を、計算して入れる問題が増えます' },
};
const SOUPS = Object.values(RAMEN).map((r) => r.soup);
const THICK = [['細麺', 30], ['中太麺', 60], ['太麺', 90]];     // 「普通」に茹でる秒数
const FIRM = [['硬め', -15], ['普通', 0], ['柔らかめ', 15]];     // 硬さによる増減
const TOPPINGS = ['チャーシュー', '煮卵', 'ネギ', 'メンマ', 'のり', 'もやし', 'コーン', 'ナルト'];

const nums = (rng, answer, near) => { const set = new Set([answer]); for (let g = 0; set.size < 4 && g < 100; g++) { const v = near(); if (v > 0 && v !== answer) set.add(v); } for (let v = answer + 5; set.size < 4; v += 5) set.add(v); return shuffle(rng, [...set]); };
const step = (kind, prompt, options, answer, extra = {}) => ({ kind, prompt, options: options.map(String), answer: options.indexOf(answer), ...extra });

const soupStep = (rng, T) => step('soup', `📋 注文: **${T.emoji} ${T.name}**\nスープは、どれ?`, shuffle(rng, [T.soup, ...shuffle(rng, SOUPS.filter((x) => x !== T.soup)).slice(0, 3)]), T.soup);
function noodleStep(rng, bonus = false) {
  const [thick, base] = pick(rng, THICK), [firm, d] = pick(rng, FIRM), ans = base + d;
  return step('noodle', `${bonus ? '🍜 **替え玉!** ' : '⏱️ 麺の茹で時間: '}麺は **${thick}**(普通で ${base}秒)。お客さんは **${firm}** がお好み(硬め -15秒 / 柔らかめ +15秒)。\n何秒、茹でる?`,
    nums(rng, ans, () => ans + pick(rng, [-30, -15, 15, 30, 45])).map((n) => `${n}秒`), `${ans}秒`, bonus ? { bonus: true } : {});
}
function toppingStep(rng) {
  const want = shuffle(rng, TOPPINGS).slice(0, ri(rng, 2, 3)), key = (a) => [...a].sort().join('・');
  const sets = new Map([[key(want), want]]);
  for (let g = 0; sets.size < 4 && g < 100; g++) { const s = shuffle(rng, TOPPINGS).slice(0, want.length); if (!sets.has(key(s))) sets.set(key(s), s); } // 正解と同じ組み合わせ(並び順違い)で、正解を上書きしない
  const opts = shuffle(rng, [...sets.values()].map((s) => s.join('・')));
  return step('topping', `🍥 トッピング: お客さんの注文は **${want.join('・')}**。どれ?`, opts, want.join('・'));
}
function fireStep(rng) { // 現在の温度に、火加減で足して、ちょうど 5 にする
  const pairs = [[2, '強火 (+3)'], [4, '中火 (+1)'], [6, '弱火 (-1)'], [8, '消火気味 (-3)']], [t, ans] = pick(rng, pairs);
  return step('fire', `🌡️ **ふつふつ**: いまの温度 ${'🔥'.repeat(t)}${'⬜'.repeat(9 - t)} (${t}/9)。ちょうど **5** にしたい。どうする?`, shuffle(rng, pairs.map((p) => p[1])), ans);
}
function spiceStep(rng) {
  const n = ri(rng, 2, 6), ans = n * 10;
  return step('spice', `🌶️ **辛さ指定**: お客さんは **${n}辛**。唐辛子は **10g で 1辛**。何g、入れる?`, nums(rng, ans, () => ans + pick(rng, [-20, -10, 10, 20, 30])).map((g) => `${g}g`), `${ans}g`);
}

/** 注文を作る(typeId を決めると、その種類)。steps: 本編の問題(+ 替え玉のおまけ) */
export function makeOrder(rng = Math.random, typeId = null) {
  const T = RAMEN[typeId] ?? pick(rng, Object.values(RAMEN));
  const steps = [soupStep(rng, T), noodleStep(rng), toppingStep(rng)];
  if (T.id === 'miso') steps.push(fireStep(rng));
  if (T.id === 'spicy') steps.push(spiceStep(rng));
  if (T.id === 'tonkotsu') steps.push(noodleStep(rng, true)); // 替え玉(おまけ)
  return { type: T.id, steps };
}

export const GRADES = {
  perfect: { label: '大成功!', mult: 1, color: 'gold' },
  good: { label: '成功', mult: 0.7, color: 'green' },
  soso: { label: 'まあまあ', mult: 0.4, color: 'gray' },
  bad: { label: '失敗…', mult: 0.1, color: 'red' },
};
/**
 * 出来栄えの評価と、給料。results: 各ステップの正誤(true/false)。remainingMs: 残り時間
 * cfg: { perfectBonus(%), speedBonus(%), kaedamaBonus(%), timeMs }
 */
export function gradeRamen(order, results, base, remainingMs, cfg) {
  const T = RAMEN[order.type];
  const main = order.steps.map((s, n) => ({ s, ok: !!results[n] })).filter((x) => !x.s.bonus);
  const right = main.filter((x) => x.ok).length, total = main.length;
  let grade = right === total ? 'perfect' : right / total >= 0.66 ? 'good' : right / total >= 0.33 ? 'soso' : 'bad';
  if (T.id === 'shio' && right < total && (grade === 'perfect' || grade === 'good')) grade = 'soso'; // 繊細: 1問でも間違えたら、まあまあ止まり
  let pct = GRADES[grade].mult * 100; const notes = [];
  if (grade === 'perfect') { pct += cfg.perfectBonus; notes.push(`満点ボーナス +${cfg.perfectBonus}%`); }
  if (T.id === 'shoyu' && (grade === 'perfect' || grade === 'good')) { const b = Math.round(cfg.speedBonus * Math.max(0, Math.min(1, remainingMs / cfg.timeMs))); if (b > 0) { pct += b; notes.push(`行列を早くさばいたチップ +${b}%`); } }
  const kaedama = order.steps.findIndex((s) => s.bonus);
  if (kaedama >= 0 && results[kaedama]) { pct += cfg.kaedamaBonus; notes.push(`替え玉を完璧に出した! +${cfg.kaedamaBonus}%`); }
  return { grade, right, total, amount: Math.round(base * pct / 100), notes };
}
