/** 指名手配: 犯罪に成功すると「手配度(heat)」が溜まり、星(⭐)が付く。時間がたつと下がる。警察(バイト)が /arrest で逮捕すると、懸賞金がもらえる */
export const MAX_HEAT = 30;     // 手配度の上限(星5つ = 25 以上)
export const HEAT_PER_STAR = 5; // 手配度 5 ごとに、星が1つ
export const HEAT = {
  crime: { convenience: 1, atm: 2, jewel: 3, pirate: 3, bank: 4 },
  heist: { armored: 4, bank: 5, museum: 5, casino: 6, vault: 8 },
};
export const ARREST = { chance: 0.5, cd: 10 * 60_000, jailPerStar: 5 * 60_000, jailMax: 30 * 60_000 };
export const CHANCE_PENALTY_PER_STAR = 0.03; // 星1つにつき、犯罪の成功率が 3% 下がる(最大 -15%)

export const starsOf = (heat, perStar = HEAT_PER_STAR) => Math.min(5, Math.floor(heat / perStar));
export const stars = (n) => '⭐'.repeat(n);
/** 懸賞金: 手配度に比例(星1つぶん = perStar) */
export const bountyOf = (heat, bountyPerStar, heatPerStar = HEAT_PER_STAR) => Math.round(bountyPerStar * Math.min(heat, heatPerStar * 6) / heatPerStar);
export const chanceDelta = (starCount, penalty = CHANCE_PENALTY_PER_STAR) => -penalty * starCount;
export const POLICE_BONUS_CAP = 0.9; // 警察のバイトのボーナス確率の上限(指名手配中の人数で上がる)
