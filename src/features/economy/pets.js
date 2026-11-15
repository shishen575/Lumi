import { emptyFx, describeFx } from './effects.js';

/**
 * ペット: 買って、餌をあげて、遊んで、育てる。なつき度(xp)が上がるとレベルが上がり、種類ごとのボーナスがつく。
 * おなかがすいている(満腹度が低い)と、ボーナスは出ない
 */
export const MAX_PETS = 24;
// ペットの種類。サーバーごとに、ダッシュボードで、自由に変えられる(名前・値段・餌・ボーナス・有効/無効)
// effects は「レベル1つぶんの効果」(足し算。0.01 = +1%)。レベルが上がるほど、効果が増える
const P = (id, emoji, name, price, effects, food = ['ごはん', '🍖'], feedCost = 150, feedHunger = 40) => ({ id, enabled: true, name, emoji, price, foodName: food[0], foodEmoji: food[1], feedCost, feedHunger, effects });
export const DEFAULT_PETS = [
  P('dog', '🐶', '犬', 1000, { crimeChance: 0.01 }, ['ドッグフード', '🦴']),
  P('cat', '🐱', '猫', 1000, { workPay: 0.02 }, ['キャットフード', '🐟']),
  P('rabbit', '🐰', 'うさぎ', 1000, { begAmount: 0.05 }, ['にんじん', '🥕']),
  P('hamster', '🐹', 'ハムスター', 1000, { toolKeep: 0.02 }, ['ひまわりの種', '🌻']),
  P('owl', '🦉', 'ふくろう', 1000, { heistTime: 0.02 }, ['ネズミ', '🐭']),
  P('fox', '🦊', 'きつね', 1500, { crimeChance: 0.008, begAmount: 0.02 }, ['油揚げ', '🍘'], 200),
  P('penguin', '🐧', 'ペンギン', 1500, { workPay: 0.015, ramenTime: 0.02 }, ['さかな', '🐟'], 200),
  P('parrot', '🦜', 'オウム', 1800, { begAmount: 0.04, ramenTime: 0.02 }, ['木の実', '🌰'], 200),
  P('turtle', '🐢', 'かめ', 2000, { toolKeep: 0.03, fineMult: -0.02 }, ['はっぱ', '🥬'], 150, 30),
  P('frog', '🐸', 'かえる', 1200, { ramenTime: 0.04 }, ['むし', '🪰']),
  P('snake', '🐍', 'へび', 2500, { crimeChance: 0.012, toolKeep: 0.02 }, ['ネズミ', '🐭'], 250),
  P('panda', '🐼', 'パンダ', 4000, { workPay: 0.02, begAmount: 0.03 }, ['笹', '🎋'], 300),
  P('horse', '🐴', 'うま', 5000, { workPay: 0.03, heistTime: 0.01 }, ['まぐさ', '🌾'], 400),
  P('tiger', '🐯', 'とら', 8000, { crimeChance: 0.015, heistTime: 0.02, fineMult: 0.02 }, ['お肉', '🥩'], 600),
  P('dragon', '🐲', 'ドラゴン', 20000, { crimeChance: 0.02, heistTime: 0.03, workPay: 0.02 }, ['宝石', '💎'], 1500, 25),
  P('unicorn', '🦄', 'ユニコーン', 30000, { workPay: 0.03, begAmount: 0.05, toolKeep: 0.03, fineMult: -0.03 }, ['虹のかけら', '🌈'], 2000, 25),
];
const clean = (x, n) => String(x ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, n);
const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
const PET_RANGE = { crimeChance: [-0.1, 0.1], workPay: [-0.5, 0.5], begAmount: [-0.5, 1], heistTime: [-0.2, 0.2], ramenTime: [-0.2, 0.5], fineMult: [-0.2, 0.5], toolKeep: [-0.2, 0.2], arrestChance: [-0.1, 0.1] }; // レベル1つぶん(回数の効果は、ペットでは使えない)
export const PET_FX_KEYS = Object.keys(PET_RANGE);
export function sanitizePetEffects(input) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(PET_RANGE)) { const raw = input?.[k]; if (raw === undefined || raw === null || raw === '') continue; const v = Math.round(num(raw, lo, hi, 0) * 10000) / 10000; if (v) out[k] = v; }
  return out;
}
/** ペットの種類のリストを、正しい形に直す(最大24種類)。空のリストや不正な入力は、いまのまま */
export function sanitizePets(input, current = DEFAULT_PETS) {
  if (!Array.isArray(input)) return current;
  const out = [], used = new Set();
  for (const raw of input.filter((x) => clean(x?.name, 12)).slice(0, MAX_PETS)) {
    let id = /^[a-z0-9_]{1,16}$/.test(String(raw?.id ?? '')) ? raw.id : null;
    if (!id || used.has(id)) { let n = 1; while (used.has(`pet_n${n}`)) n++; id = `pet_n${n}`; }
    used.add(id);
    out.push({ id, enabled: raw?.enabled !== false, name: clean(raw?.name, 12), emoji: [...clean(raw?.emoji, 8)].slice(0, 2).join('') || '🐾',
      price: Math.round(num(raw?.price, 0, 1e9, 1000)), foodName: clean(raw?.foodName, 12) || 'ごはん', foodEmoji: [...clean(raw?.foodEmoji, 8)].slice(0, 2).join('') || '🍖',
      feedCost: Math.round(num(raw?.feedCost, 0, 1e9, 150)), feedHunger: Math.round(num(raw?.feedHunger, 1, 100, 40)), effects: sanitizePetEffects(raw?.effects) });
  }
  return out.length ? out : current;
}
export const petList = (s) => s.petSpecies ?? DEFAULT_PETS;
export const petsOpen = (s) => petList(s).filter((x) => x.enabled); // 飼える種類(番号は、この並び)
const GONE = { id: '', enabled: false, name: 'ペット', emoji: '🐾', price: 0, foodName: 'ごはん', foodEmoji: '🍖', feedCost: 150, feedHunger: 40, effects: {} };
/** 飼っているペットの種類。設定から消されていたら、ボーナスなしの「ペット」として扱う */
export const speciesOf = (s, id) => petList(s).find((x) => x.id === id) ?? { ...GONE, id };
/** レベルに応じた、いまのボーナス(強さ power% を反映) */
export const bonusOf = (sp, level, power = 100) => Object.fromEntries(Object.entries(sp.effects ?? {}).map(([k, v]) => [k, v * level * power / 100]));
export const bonusLabel = (sp, power = 100, level = 1) => describeFx(bonusOf(sp, level, power)) || '(ボーナスなし)';

export const LEVEL_XP = [0, 50, 150, 300, 500, 800, 1200, 1800, 2600, 3600]; // レベル1〜10に必要な、なつき度
export const MAX_LEVEL = LEVEL_XP.length;
export const levelOf = (xp) => { let lv = 1; LEVEL_XP.forEach((need, n) => { if (xp >= need) lv = n + 1; }); return lv; };
export const nextXp = (xp) => LEVEL_XP[levelOf(xp)] ?? null;
/** 満腹度: 保存した値から、時間で減らして、いまの値にする */
export const hungerNow = (row, decayPerHour, now = Date.now()) => Math.max(0, Math.round(row.hunger - ((now - row.fed_at) / 3600_000) * decayPerHour));
/** そのペットの、いまのボーナス(効果)。おなかがすいていたら、何もなし。power(%)で、強さを変えられる */
export function petFx(row, cfg, sp, now = Date.now()) {
  const fx = emptyFx(); if (!row || !sp || hungerNow(row, cfg.hungerDecay, now) < cfg.minHunger) return fx;
  return { ...fx, ...bonusOf(sp, levelOf(row.xp), cfg.power) };
}
export const hungerBar = (h) => `${'🟩'.repeat(Math.round(h / 10))}${'⬜'.repeat(10 - Math.round(h / 10))} ${h}/100`;
