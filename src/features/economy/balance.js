import { CRIMES, JOBS, BEG } from './jobs.js';
import { HEISTS } from './heist.js';
import { ITEMS } from './market.js';
import { HEAT, HEAT_PER_STAR, CHANCE_PENALTY_PER_STAR, ARREST } from './wanted.js';

/**
 * ゲームバランス: ゲームの数字を、サーバーごとに、ダッシュボードから変えられるようにする。
 * SCHEMA が「変えられる数字」の一覧(初期値は、コードの定数)。サーバーの上書き値は、settings.balance に { キー: 数値 } で持ち、
 * 上書きがなければ、初期値のまま。下の xxxOf(s, …) が、上書きを反映した、実際に使う値を返す
 */
const MIN = 60_000;
const p = (key, section, group, label, def, min, max, unit = '', extra = {}) => ({ key, section, group, label, def, min, max, unit, ...extra });

function buildSchema() {
  const L = [];
  for (const [k, c] of Object.entries(CRIMES)) {
    const g = `${c.emoji} ${c.name}`, pre = `crime.${k}.`;
    L.push(p(pre + 'chance', '犯罪', g, '成功率', Math.round(c.chance * 100), 1, 95, '%'));
    L.push(p(pre + 'winMin', '犯罪', g, '成功の報酬(最小)', c.win[0], 0, 1e9, '$', { pair: pre + 'winMax', side: 'min' }));
    L.push(p(pre + 'winMax', '犯罪', g, '成功の報酬(最大)', c.win[1], 0, 1e9, '$', { pair: pre + 'winMin', side: 'max' }));
    L.push(p(pre + 'fineMin', '犯罪', g, '失敗の罰金(最小)', c.fine[0], 0, 1e9, '$', { pair: pre + 'fineMax', side: 'min' }));
    L.push(p(pre + 'fineMax', '犯罪', g, '失敗の罰金(最大)', c.fine[1], 0, 1e9, '$', { pair: pre + 'fineMin', side: 'max' }));
    L.push(p(pre + 'jail', '犯罪', g, '失敗したときの留置場', c.jail / MIN, 0, 1440, '分'));
    L.push(p(pre + 'cd', '犯罪', g, '次にできるまでの時間', c.cd / MIN, 0, 10080, '分'));
  }
  for (const [k, j] of Object.entries(JOBS)) {
    const g = `${j.emoji} ${j.name}`, pre = `job.${k}.`;
    L.push(p(pre + 'payMin', 'バイト', g, '給料(最小)', j.pay[0], 0, 1e9, '$', { pair: pre + 'payMax', side: 'min' }));
    L.push(p(pre + 'payMax', 'バイト', g, '給料(最大)', j.pay[1], 0, 1e9, '$', { pair: pre + 'payMin', side: 'max' }));
    L.push(p(pre + 'cd', 'バイト', g, '次にできるまでの時間', j.cd / MIN, 0, 10080, '分'));
    if (j.bonus) {
      L.push(p(pre + 'bonusChance', 'バイト', g, 'ボーナスの確率', Math.round(j.bonus.chance * 100), 0, 95, '%'));
      L.push(p(pre + 'bonusMin', 'バイト', g, 'ボーナス(最小)', j.bonus.amount[0], 0, 1e9, '$', { pair: pre + 'bonusMax', side: 'min' }));
      L.push(p(pre + 'bonusMax', 'バイト', g, 'ボーナス(最大)', j.bonus.amount[1], 0, 1e9, '$', { pair: pre + 'bonusMin', side: 'max' }));
    }
  }
  const rg = '🍜 ラーメン屋(ミニゲーム)';
  L.push(p('ramen.timeSec', 'バイト', rg, '制限時間', 120, 20, 600, '秒'));
  L.push(p('ramen.perfectBonus', 'バイト', rg, '満点(大成功)のボーナス', 20, 0, 300, '%'));
  L.push(p('ramen.speedBonus', 'バイト', rg, '醤油ラーメン: 早く出したときの最大チップ', 25, 0, 300, '%'));
  L.push(p('ramen.kaedamaBonus', 'バイト', rg, '豚骨ラーメン: 替え玉を完璧に出したときのチップ', 30, 0, 300, '%'));
  const bg = '🙏 乞食';
  L.push(p('beg.cd', '乞食', bg, '次にできるまでの時間', BEG.cd / MIN, 0, 10080, '分'));
  L.push(p('beg.richPct', '乞食', bg, '大金をもらえる確率', 5, 0, 100, '%'));
  L.push(p('beg.richMin', '乞食', bg, '大金(最小)', 200, 0, 1e9, '$', { pair: 'beg.richMax', side: 'min' }));
  L.push(p('beg.richMax', '乞食', bg, '大金(最大)', 500, 0, 1e9, '$', { pair: 'beg.richMin', side: 'max' }));
  L.push(p('beg.okPct', '乞食', bg, '小銭をもらえる確率', 65, 0, 100, '%'));
  L.push(p('beg.okMin', '乞食', bg, '小銭(最小)', 10, 0, 1e9, '$', { pair: 'beg.okMax', side: 'min' }));
  L.push(p('beg.okMax', '乞食', bg, '小銭(最大)', 80, 0, 1e9, '$', { pair: 'beg.okMin', side: 'max' }));
  for (const T of Object.values(HEISTS)) {
    const g = `${T.emoji} ${T.name}`, pre = `heist.${T.id}.`;
    L.push(p(pre + 'steps', '大型犯罪', g, '問題の数', T.steps, 1, 12, '問'));
    L.push(p(pre + 'timeSec', '大型犯罪', g, '制限時間', T.timeMs / 1000, 10, 600, '秒'));
    L.push(p(pre + 'maxMistakes', '大型犯罪', g, '間違えてよい回数', T.maxMistakes, 0, 10, '回'));
    L.push(p(pre + 'winMin', '大型犯罪', g, '成功の報酬(最小)', T.win[0], 0, 1e9, '$', { pair: pre + 'winMax', side: 'min' }));
    L.push(p(pre + 'winMax', '大型犯罪', g, '成功の報酬(最大)', T.win[1], 0, 1e9, '$', { pair: pre + 'winMin', side: 'max' }));
    L.push(p(pre + 'speedBonus', '大型犯罪', g, '早く終えたときの、最大ボーナス', Math.round(T.speedBonus * 100), 0, 300, '%'));
    L.push(p(pre + 'fineMin', '大型犯罪', g, '失敗の罰金(最小)', T.fine[0], 0, 1e9, '$', { pair: pre + 'fineMax', side: 'min' }));
    L.push(p(pre + 'fineMax', '大型犯罪', g, '失敗の罰金(最大)', T.fine[1], 0, 1e9, '$', { pair: pre + 'fineMin', side: 'max' }));
    L.push(p(pre + 'jail', '大型犯罪', g, '失敗したときの留置場', T.jail / MIN, 0, 1440, '分'));
    L.push(p(pre + 'cd', '大型犯罪', g, '次に挑戦できるまでの時間', T.cd / MIN, 0, 10080, '分'));
  }
  L.push(p('heist.timeoutFinePct', '大型犯罪', '⏰ 時間切れ(制限時間を過ぎた・放置した)', '罰金の割合(失敗の罰金に対して)', 100, 0, 100, '%'));
  L.push(p('heist.timeoutJailPct', '大型犯罪', '⏰ 時間切れ(制限時間を過ぎた・放置した)', '留置場の割合(失敗の留置場に対して)', 100, 0, 100, '%'));
  for (const it of ITEMS) L.push(p(`item.${it.id}.price`, '闇マーケット', '🕶️ 道具の値段(基本)', `${it.emoji} ${it.name}`, it.price, 1, 1e9, '$'));
  L.push(p('market.rateLow', '闇マーケット', '🕶️ 闇相場と所持数', '相場の下限(基本の値段に対する)', 80, 10, 100, '%'));
  L.push(p('market.rateHigh', '闇マーケット', '🕶️ 闇相場と所持数', '相場の上限', 130, 100, 500, '%'));
  L.push(p('market.maxStack', '闇マーケット', '🕶️ 闇相場と所持数', '1種類の道具を持てる上限', 99, 1, 9999, '個'));
  const wg = '🚨 指名手配のしくみ';
  L.push(p('wanted.heatPerStar', '指名手配', wg, '星1つに必要な手配度', HEAT_PER_STAR, 1, 100, ''));
  L.push(p('wanted.penaltyPerStar', '指名手配', wg, '星1つあたり、犯罪の成功率が下がる量', Math.round(CHANCE_PENALTY_PER_STAR * 100), 0, 30, '%'));
  L.push(p('wanted.arrestChance', '指名手配', wg, '逮捕の成功率', Math.round(ARREST.chance * 100), 1, 100, '%'));
  L.push(p('wanted.arrestCd', '指名手配', wg, '逮捕の待ち時間', ARREST.cd / MIN, 0, 1440, '分'));
  L.push(p('wanted.jailPerStar', '指名手配', wg, '逮捕された人の留置場(星1つあたり)', ARREST.jailPerStar / MIN, 0, 1440, '分'));
  L.push(p('wanted.jailMax', '指名手配', wg, '逮捕された人の留置場(上限)', ARREST.jailMax / MIN, 0, 1440, '分'));
  for (const [k, c] of Object.entries(CRIMES)) L.push(p(`heat.crime.${k}`, '指名手配', '🔥 成功したときに上がる手配度', `${c.emoji} ${c.name}`, HEAT.crime[k] ?? 1, 0, 100, ''));
  for (const T of Object.values(HEISTS)) L.push(p(`heat.heist.${T.id}`, '指名手配', '🔥 成功したときに上がる手配度', `${T.emoji} ${T.name}`, HEAT.heist[T.id] ?? 4, 0, 100, ''));
  L.push(p('bail.perMin', 'その他', '🔓 保釈', '保釈金(留置場の残り1分あたり)', 100, 0, 1e6, '$'));
  return L;
}
export const SCHEMA = buildSchema();
const MAP = new Map(SCHEMA.map((x) => [x.key, x]));

/** 上書き値を、正しい形に直す。values: { キー: 数値 | null(初期値に戻す) }。知らないキーは捨てる。範囲内に収め、最小と最大が逆なら入れ替える */
export function sanitizeBalance(values, current = {}) {
  const out = { ...(current ?? {}) };
  for (const [key, raw] of Object.entries(values ?? {})) {
    const def = MAP.get(key); if (!def) continue;
    if (raw === null || raw === '' || raw === undefined) { delete out[key]; continue; }
    const n = Math.floor(Number(raw)); if (!Number.isFinite(n)) continue;
    const v = Math.min(def.max, Math.max(def.min, n));
    if (v === def.def) delete out[key]; else out[key] = v; // 初期値と同じなら、上書きとして持たない
  }
  for (const def of SCHEMA) { // 最小 > 最大 のときは、入れ替える
    if (def.side !== 'min') continue;
    const lo = out[def.key] ?? def.def, hi = out[def.pair] ?? MAP.get(def.pair).def;
    if (lo > hi) { for (const [k, v] of [[def.key, hi], [def.pair, lo]]) { if (v === MAP.get(k).def) delete out[k]; else out[k] = v; } }
  }
  return out;
}
export const val = (s, key) => s?.balance?.[key] ?? MAP.get(key).def;
const range = (s, a, b) => [val(s, a), val(s, b)];

/* ----- 上書きを反映した、実際に使う値(もとの形のまま。文章や絵文字は、そのまま) ----- */
export const crimeOf = (s, k) => { const c = CRIMES[k], pre = `crime.${k}.`; return { ...c, chance: val(s, pre + 'chance') / 100, win: range(s, pre + 'winMin', pre + 'winMax'), fine: range(s, pre + 'fineMin', pre + 'fineMax'), jail: val(s, pre + 'jail') * MIN, cd: val(s, pre + 'cd') * MIN }; };
export const jobOf = (s, k) => {
  const j = JOBS[k], pre = `job.${k}.`;
  return { ...j, pay: range(s, pre + 'payMin', pre + 'payMax'), cd: val(s, pre + 'cd') * MIN,
    ...(j.bonus ? { bonus: { ...j.bonus, chance: val(s, pre + 'bonusChance') / 100, amount: range(s, pre + 'bonusMin', pre + 'bonusMax') } } : {}) };
};
export const ramenCfg = (s) => ({ timeMs: val(s, 'ramen.timeSec') * 1000, perfectBonus: val(s, 'ramen.perfectBonus'), speedBonus: val(s, 'ramen.speedBonus'), kaedamaBonus: val(s, 'ramen.kaedamaBonus') });
export const begOf = (s) => ({ ...BEG, cd: val(s, 'beg.cd') * MIN, richPct: val(s, 'beg.richPct'), okPct: val(s, 'beg.okPct'), rich: range(s, 'beg.richMin', 'beg.richMax'), okRange: range(s, 'beg.okMin', 'beg.okMax') });
export const heistOf = (s, id) => {
  const T = HEISTS[id] ?? HEISTS.bank, pre = `heist.${T.id}.`;
  return { ...T, steps: val(s, pre + 'steps'), timeMs: val(s, pre + 'timeSec') * 1000, maxMistakes: val(s, pre + 'maxMistakes'), win: range(s, pre + 'winMin', pre + 'winMax'),
    speedBonus: val(s, pre + 'speedBonus') / 100, fine: range(s, pre + 'fineMin', pre + 'fineMax'), jail: val(s, pre + 'jail') * MIN, cd: val(s, pre + 'cd') * MIN };
};
export const timeoutCfg = (s) => ({ finePct: val(s, 'heist.timeoutFinePct') / 100, jailPct: val(s, 'heist.timeoutJailPct') / 100 }); // 時間切れの扱い(100% = 失敗と同じ。0% = 罰なしの撤退)
export const itemOf = (s, item) => ({ ...item, price: val(s, `item.${item.id}.price`) });
export const marketCfg = (s) => ({ range: [val(s, 'market.rateLow') / 100, val(s, 'market.rateHigh') / 100], maxStack: val(s, 'market.maxStack') });
export const wantedCfg = (s) => {
  const heatPerStar = val(s, 'wanted.heatPerStar');
  return { heatPerStar, maxHeat: heatPerStar * 6, penalty: val(s, 'wanted.penaltyPerStar') / 100, arrestChance: val(s, 'wanted.arrestChance') / 100, arrestCd: val(s, 'wanted.arrestCd') * MIN,
    jailPerStar: val(s, 'wanted.jailPerStar') * MIN, jailMax: val(s, 'wanted.jailMax') * MIN,
    heatCrime: (k) => val(s, `heat.crime.${k}`), heatHeist: (id) => val(s, `heat.heist.${id}`) };
};
export const bailPerMin = (s) => val(s, 'bail.perMin');
