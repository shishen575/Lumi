/**
 * 効果(バフ・デバフ)の共通の仕組み。お店の消耗品(タバコ・お酒)と、ペットが、同じ形で、ゲームに影響する。
 * 数字はすべて「足し算」: crimeChance = 犯罪の成功率に足す(0.05 = +5ポイント)、他は 1 + 値 を掛ける(0.1 = +10%)
 */
export const FX = {
  crimeChance: { label: '犯罪の成功率', kind: 'pp' },
  workPay: { label: 'バイトの給料', kind: 'pct' },
  begAmount: { label: '乞食の金額', kind: 'pct' },
  heistTime: { label: '大型犯罪の制限時間', kind: 'pct' },
  ramenTime: { label: 'ラーメン屋の制限時間', kind: 'pct' },
  heistMistakes: { label: '大型犯罪の、間違えてよい回数', kind: 'count' },
  fineMult: { label: '失敗したときの罰金', kind: 'pct' },
  toolKeep: { label: '使った道具を持ち帰る確率', kind: 'pp' },
};
export const emptyFx = () => Object.fromEntries(Object.keys(FX).map((k) => [k, 0]));
export const addFx = (a, b, scale = 1) => { const out = { ...a }; for (const k of Object.keys(FX)) out[k] = (out[k] ?? 0) + (b?.[k] ?? 0) * (k === 'heistMistakes' ? 1 : scale); return out; };
/** 効果の説明の文(例: 犯罪の成功率 +3%) */
export function describeFx(fx) {
  const parts = [];
  for (const [k, d] of Object.entries(FX)) {
    const v = fx?.[k]; if (!v) continue;
    const sign = v > 0 ? '+' : '', num = d.kind === 'count' ? `${sign}${v}回` : `${sign}${Math.round(v * 1000) / 10}%`;
    parts.push(`${d.label} ${num}`);
  }
  return parts.join(' / ');
}
