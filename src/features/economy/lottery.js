import { randomInt } from 'node:crypto';

/**
 * 宝くじ: 番号(2〜4桁)のくじを買う。決まった時刻に、自動で抽選する。サーバーごとに、自由に、複数のくじを作れる。
 *   1等 = 全部の桁が一致 → ジャックポット(当たりが出なければ、次回に持ち越し。当たりが複数なら、枚数で等分)
 *   2等 = 下の(桁数-1)桁が一致(1等を除く)→ くじ代の x倍率
 *   3等 = 下の(桁数-2)桁が一致(1・2等を除く。桁数が3以上のとき)→ くじ代の x倍率
 */
export const MAX_LOTTERIES = 6;
export const DAY_MS = 86400_000;
export const DEFAULT_LOTTERY = { id: 'lot_1', name: '宝くじ', emoji: '🎟️', price: 100, maxTickets: 20, drawHours: 24, drawAtHour: 21, digits: 3, jackpotBase: 50000, jackpotShare: 40, prize2: 20, prize3: 2, channelId: null };

const clean = (x, n) => String(x ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, n);
const int = (v, lo, hi, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
/** くじの一覧を、正しい形に直す(最大6つ・名前・値段・桁数など)。空のリストや不正な入力は、いまのまま */
export function sanitizeLotteries(input, current = [DEFAULT_LOTTERY]) {
  if (!Array.isArray(input)) return current;
  const out = [], used = new Set();
  for (const raw of input.filter((x) => clean(x?.name, 12)).slice(0, MAX_LOTTERIES)) { // 名前が空のものは捨ててから、最大6つ
    const name = clean(raw?.name, 12);
    let id = /^lot_[a-z0-9]{1,8}$/.test(String(raw?.id ?? '')) ? raw.id : null;
    if (!id || used.has(id)) { let n = 1; while (used.has(`lot_n${n}`)) n++; id = `lot_n${n}`; }
    used.add(id);
    out.push({
      id, name, emoji: [...clean(raw?.emoji, 8)].slice(0, 2).join('') || '🎟️',
      price: int(raw?.price, 1, 1e9, 100), maxTickets: int(raw?.maxTickets, 1, 1000, 20), drawHours: int(raw?.drawHours, 1, 168, 24), drawAtHour: int(raw?.drawAtHour, 0, 23, 21),
      digits: int(raw?.digits, 2, 4, 3), jackpotBase: int(raw?.jackpotBase, 0, 1e9, 50000), jackpotShare: int(raw?.jackpotShare, 0, 100, 40),
      prize2: int(raw?.prize2, 0, 10000, 20), prize3: int(raw?.prize3, 0, 10000, 2), channelId: /^\d{15,25}$/.test(String(raw?.channelId ?? '')) ? String(raw.channelId) : null,
    });
  }
  return out.length ? out : current;
}
export const lotteriesOf = (s) => s.lotteries ?? [DEFAULT_LOTTERY];
export const lotteryById = (s, id) => lotteriesOf(s).find((x) => x.id === id) ?? null;

export const periodOf = (L) => L.drawHours * 3600_000;
/** 抽選の基準時刻(日本時間の drawAtHour 時 = UTC の (drawAtHour - 9) 時) */
export const offsetOf = (L) => (((L.drawAtHour - 9) % 24 + 24) % 24) * 3600_000;
/** いまの回(round)。回 k は、(k × 間隔 + 基準)〜 次の抽選の時刻 の間に買ったくじ */
export const roundOf = (now, L) => Math.floor((now - offsetOf(L)) / periodOf(L));
export const drawTimeOf = (round, L) => (round + 1) * periodOf(L) + offsetOf(L); // その回の、抽選の時刻
export const pad = (n, digits = 3) => String(n).padStart(digits, '0');
export const numbersCount = (digits) => 10 ** digits;
/** 当選の等級(0 = はずれ) */
export function prizeTier(number, winning, digits = 3) {
  if (number === winning) return 1;
  if (number % 10 ** (digits - 1) === winning % 10 ** (digits - 1)) return 2;
  if (digits >= 3 && number % 10 ** (digits - 2) === winning % 10 ** (digits - 2)) return 3;
  return 0;
}
export const drawNumber = (digits = 3, rng = null) => (rng ? Math.floor(rng() * 10 ** digits) : randomInt(0, 10 ** digits));
/** 当たる確率と、還元率の目安(くじ代に対する、1枚あたりの期待値。ジャックポットが最低額のとき) */
export function estimateRtp(L) {
  const d = L.digits, p1 = 1 / 10 ** d, q2 = 1 / 10 ** (d - 1), p2 = q2 - p1;
  const q3 = d >= 3 ? 1 / 10 ** (d - 2) : q2, p3 = d >= 3 ? q3 - q2 : 0;
  return { win1: p1, win2: p2, win3: p3, rtp: p1 * (L.jackpotBase / L.price) + p2 * L.prize2 + p3 * L.prize3 };
}
/**
 * 抽選の結果を計算する(お金の移動は、しない)。tickets: [{ user_id, number, qty, price }]。ticket.price = 買ったときのくじ代
 */
export function settleRound(tickets, winning, L, jackpot) {
  const payouts = new Map(), win1 = [];
  let sales = 0, qty1 = 0;
  const add = (u, tier, qty, amount) => { const p = payouts.get(u) ?? { amount: 0, tiers: { 1: 0, 2: 0, 3: 0 }, amounts: { 1: 0, 2: 0, 3: 0 } }; p.amount += amount; p.tiers[tier] += qty; p.amounts[tier] += amount; payouts.set(u, p); }; // amounts: 等ごとの当選金(発表で、等ごとに見せる)
  for (const t of tickets) {
    sales += t.price * t.qty;
    const tier = prizeTier(t.number, winning, L.digits);
    if (tier === 1) { win1.push(t); qty1 += t.qty; }
    else if (tier === 2) add(t.user_id, 2, t.qty, Math.round(t.price * L.prize2 * t.qty));
    else if (tier === 3) add(t.user_id, 3, t.qty, Math.round(t.price * L.prize3 * t.qty));
  }
  if (qty1 > 0) for (const t of win1) add(t.user_id, 1, t.qty, Math.floor(jackpot * t.qty / qty1)); // ジャックポットを、当たりのくじの枚数で等分
  return { winning, jackpot, jackpotWon: qty1 > 0, payouts, sales, win1Qty: qty1 };
}
/** 次の回に持ち越す、ジャックポット: 当たりが出れば、最低額に戻る。出なければ、そのまま + 売上の一部 */
export const nextJackpot = (result, L, jackpot) => (result.jackpotWon ? L.jackpotBase : jackpot + Math.floor(result.sales * L.jackpotShare / 100));
