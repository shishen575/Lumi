import { JOBS } from './jobs.js';

/** 職業の昇進: 出勤回数(shifts)に応じて、階級が上がり、給料の倍率(pct = %)が上がる。サーバーで編集できる */
export const MAX_RANKS = 8;
export const DEFAULT_RANKS = {
  convenience: [{ name: '新人', shifts: 0, pct: 100 }, { name: '一人前', shifts: 10, pct: 120 }, { name: '副店長', shifts: 30, pct: 150 }, { name: '店長', shifts: 80, pct: 200 }],
  police: [{ name: '巡査', shifts: 0, pct: 100 }, { name: '巡査部長', shifts: 10, pct: 120 }, { name: '警部', shifts: 30, pct: 150 }, { name: '警視', shifts: 80, pct: 200 }],
  fastfood: [{ name: 'クルー', shifts: 0, pct: 100 }, { name: 'トレーナー', shifts: 10, pct: 120 }, { name: '社員', shifts: 30, pct: 150 }, { name: '店長', shifts: 80, pct: 200 }],
};

const int = (v, lo, hi, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
/** 入力を、正しい形に直す。最初の階級は「0回・100%」に固定。回数は、増える順に並べ、同じ回数は1つにする。不正なら、その職業は初期値 */
export function sanitizeRanks(input, current = DEFAULT_RANKS) {
  const out = {};
  for (const key of Object.keys(JOBS)) {
    const list = input?.[key];
    if (!Array.isArray(list) || !list.length) { out[key] = current?.[key] ?? DEFAULT_RANKS[key]; continue; }
    const rows = list.slice(0, MAX_RANKS).map((r, n) => ({
      name: String(r?.name ?? '').trim().slice(0, 12) || `ランク${n + 1}`,
      shifts: int(r?.shifts, 0, 100000, 0), pct: int(r?.pct, 50, 500, 100),
    })).sort((a, b) => a.shifts - b.shifts);
    const seen = new Set(), clean = [];
    for (const r of rows) { if (seen.has(r.shifts)) continue; seen.add(r.shifts); clean.push(r); }
    clean[0] = { ...clean[0], shifts: 0 }; // 最初の階級は、0回から
    out[key] = clean;
  }
  return out;
}
/** 出勤回数に対する、階級。{ index, rank, next(次の階級 or null), left(次の昇進まで、あと何回) } */
export function rankFor(ranks, shifts) {
  let index = 0;
  ranks.forEach((r, n) => { if (shifts >= r.shifts) index = n; });
  const next = ranks[index + 1] ?? null;
  return { index, rank: ranks[index], next, left: next ? next.shifts - shifts : 0 };
}
export const scalePay = (amount, pct) => Math.round(amount * pct / 100);
