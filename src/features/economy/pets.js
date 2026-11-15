import { emptyFx } from './effects.js';

/**
 * ペット: 買って、餌をあげて、遊んで、育てる。なつき度(xp)が上がるとレベルが上がり、種類ごとのボーナスがつく。
 * おなかがすいている(満腹度が低い)と、ボーナスは出ない
 */
export const SPECIES = {
  dog: { id: 'dog', name: '犬', emoji: '🐶', bonus: 'crimeChance', per: 0.01, text: '犯罪の成功率' },
  cat: { id: 'cat', name: '猫', emoji: '🐱', bonus: 'workPay', per: 0.02, text: 'バイトの給料' },
  rabbit: { id: 'rabbit', name: 'うさぎ', emoji: '🐰', bonus: 'begAmount', per: 0.05, text: '乞食の金額' },
  hamster: { id: 'hamster', name: 'ハムスター', emoji: '🐹', bonus: 'toolKeep', per: 0.02, text: '道具を持ち帰る確率' },
  owl: { id: 'owl', name: 'ふくろう', emoji: '🦉', bonus: 'heistTime', per: 0.02, text: '大型犯罪の制限時間' },
};
export const LEVEL_XP = [0, 50, 150, 300, 500, 800, 1200, 1800, 2600, 3600]; // レベル1〜10に必要な、なつき度
export const MAX_LEVEL = LEVEL_XP.length;
export const levelOf = (xp) => { let lv = 1; LEVEL_XP.forEach((need, n) => { if (xp >= need) lv = n + 1; }); return lv; };
export const nextXp = (xp) => LEVEL_XP[levelOf(xp)] ?? null;
/** 満腹度: 保存した値から、時間で減らして、いまの値にする */
export const hungerNow = (row, decayPerHour, now = Date.now()) => Math.max(0, Math.round(row.hunger - ((now - row.fed_at) / 3600_000) * decayPerHour));
/** そのペットの、いまのボーナス(効果)。おなかがすいていたら、何もなし。power(%)で、強さを変えられる */
export function petFx(row, cfg, now = Date.now()) {
  const fx = emptyFx(); if (!row) return fx;
  const sp = SPECIES[row.species]; if (!sp || hungerNow(row, cfg.hungerDecay, now) < cfg.minHunger) return fx;
  fx[sp.bonus] = sp.per * levelOf(row.xp) * cfg.power / 100;
  return fx;
}
export const hungerBar = (h) => `${'🟩'.repeat(Math.round(h / 10))}${'⬜'.repeat(10 - Math.round(h / 10))} ${h}/100`;
