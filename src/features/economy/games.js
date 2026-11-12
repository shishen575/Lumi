/** ゲームのルール。乱数(rng)を差し替えられる純粋な関数だけにして、テストできるようにしてある */
export const rnd = Math.random;
const int = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* ================= チンチロ ================= */
// 強さ: ピンゾロ > ゾロ目(6が最強) > シゴロ(4-5-6) > 目(1〜6) > 目なし > ヒフミ(1-2-3)
export function chinchiroRole(dice) {
  const [a, b, c] = [...dice].sort((x, y) => x - y);
  if (a === b && b === c) return a === 1 ? { kind: 'pinzoro', label: 'ピンゾロ', strength: 100, mult: 5 } : { kind: 'zorome', label: `ゾロ目(${a})`, strength: 90 + a, mult: 3 };
  if (a === 4 && b === 5 && c === 6) return { kind: 'shigoro', label: 'シゴロ', strength: 80, mult: 2 };
  if (a === 1 && b === 2 && c === 3) return { kind: 'hifumi', label: 'ヒフミ', strength: 0, mult: 2 };
  if (a === b) return { kind: 'me', label: `目(${c})`, strength: 10 + c, mult: 1 };
  if (b === c) return { kind: 'me', label: `目(${a})`, strength: 10 + a, mult: 1 };
  return null; // 役なし
}
/** 役が出るまで、最大3回振る。出なければ「目なし」 */
export function chinchiroPlay(rng = rnd) {
  const throws = [];
  for (let t = 0; t < 3; t++) {
    const dice = [int(rng, 1, 6), int(rng, 1, 6), int(rng, 1, 6)];
    throws.push(dice);
    const role = chinchiroRole(dice);
    if (role) return { throws, dice, role };
  }
  return { throws, dice: throws.at(-1), role: { kind: 'menashi', label: '目なし', strength: 5, mult: 1 } };
}
/** プレイヤーと親を比べる。倍率は、勝った側の役(ヒフミのときは、負けた側が2倍払い) */
export function chinchiroCompare(p, d) {
  if (p.role.strength === d.role.strength) return { result: 'draw', mult: 0 };
  if (p.role.strength > d.role.strength) return { result: 'win', mult: d.role.kind === 'hifumi' ? 2 : p.role.mult };
  return { result: 'lose', mult: p.role.kind === 'hifumi' ? 2 : d.role.mult };
}

/* ================= スロット ================= */
// 3つのリールは、それぞれ独立。weight は出やすさ、three は3つ揃ったときの倍率(賭け金に対する戻り)
export const SLOT_SYMBOLS = [
  { s: '🍒', w: 30, three: 5 }, { s: '🍋', w: 25, three: 8 }, { s: '🔔', w: 18, three: 12 }, { s: '🍇', w: 14, three: 20 },
  { s: '⭐', w: 8, three: 50 }, { s: '💎', w: 4, three: 100 }, { s: '7️⃣', w: 1, three: 500 },
];
export const CHERRY_TWO = 1.5, CHERRY_ONE = 0.5; // 🍒が2つ・1つのときの戻り(還元率 約92%)
export function slotSpin(rng = rnd) {
  const total = SLOT_SYMBOLS.reduce((a, x) => a + x.w, 0);
  return Array.from({ length: 3 }, () => { let r = rng() * total; for (const x of SLOT_SYMBOLS) { r -= x.w; if (r < 0) return x.s; } return SLOT_SYMBOLS[0].s; });
}
/** 賭け金に対する戻りの倍率(0なら、はずれ) */
export function slotMultiplier(reels) {
  if (reels[0] === reels[1] && reels[1] === reels[2]) return SLOT_SYMBOLS.find((x) => x.s === reels[0]).three;
  const cherries = reels.filter((r) => r === '🍒').length;
  return cherries === 2 ? CHERRY_TWO : cherries === 1 ? CHERRY_ONE : 0;
}
export function slotRtp() {
  const total = SLOT_SYMBOLS.reduce((a, x) => a + x.w, 0); let ev = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) ev += (a.w / total) * (b.w / total) * (c.w / total) * slotMultiplier([a.s, b.s, c.s]);
  return ev;
}

/* ================= ブラックジャック ================= */
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
export const cardText = (c) => `${SUITS[c % 4]}${RANKS[Math.floor(c / 4)]}`; // カードは 0〜51 の数
const cardValue = (c) => Math.min(10, Math.floor(c / 4) + 1);               // A は 1(あとで 11 に切り替える)
export function handValue(cards) {
  let total = cards.reduce((a, c) => a + cardValue(c), 0);
  const hasAce = cards.some((c) => Math.floor(c / 4) === 0);
  if (hasAce && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}
export const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;
export function shuffledDeck(rng = rnd) {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
/** 配り直し。ナチュラルブラックジャック(最初の2枚が21)があれば、すぐ決着 */
export function bjDeal(bet, rng = rnd) {
  const deck = shuffledDeck(rng);
  const st = { bet, deck, player: [deck.pop(), deck.pop()], dealer: [deck.pop(), deck.pop()], doubled: false };
  const pn = isNatural(st.player), dn = isNatural(st.dealer);
  if (pn || dn) return { ...st, done: true, ...bjSettle(st, true) };
  return { ...st, done: false };
}
/** 親は17以上になるまで引く(ソフト17も止まる)。そのあと勝敗を決める */
function bjSettle(st, natural = false) {
  const p = handValue(st.player).total;
  if (!natural) while (handValue(st.dealer).total < 17) st.dealer.push(st.deck.pop());
  const d = handValue(st.dealer).total;
  const pn = natural && isNatural(st.player), dn = natural && isNatural(st.dealer);
  if (pn && dn) return { outcome: 'push', payout: st.bet };
  if (pn) return { outcome: 'blackjack', payout: Math.floor(st.bet * 2.5) };    // ブラックジャックは 3:2
  if (dn) return { outcome: 'lose', payout: 0 };
  if (p > 21) return { outcome: 'bust', payout: 0 };
  if (d > 21 || p > d) return { outcome: 'win', payout: st.bet * 2 };
  if (p === d) return { outcome: 'push', payout: st.bet };
  return { outcome: 'lose', payout: 0 };
}
export function bjHit(st) {
  st.player.push(st.deck.pop());
  const v = handValue(st.player).total;
  if (v > 21) return { ...st, done: true, ...bjSettle(st) };
  if (v === 21) return { ...st, done: true, ...bjSettle(st) };          // 21 は、自動で止まる
  return st;
}
export const bjStand = (st) => ({ ...st, done: true, ...bjSettle(st) });
/** ダブルダウン: 賭け金を2倍にして、1枚だけ引いて、勝負する(最初の2枚のときだけ) */
export function bjDouble(st) {
  st.bet *= 2; st.doubled = true; st.player.push(st.deck.pop());
  return { ...st, done: true, ...bjSettle(st) };
}

/* ================= 還元率(RTP)の調整 =================
 * 勝ったときの「儲け」を、係数 k 倍にして、平均の戻り(還元率)を、指定したパーセントに合わせる。
 *  - スロット・チンチロ: 全パターンを数えて、正確に合わせる
 *  - ブラックジャック: プレイヤーの腕で変わるので、「17以上で止まり、9〜11でダブル」という標準的な打ち方で見積もった目安
 * 小数になる配当は、確率で切り上げ・切り捨てをして、平均が崩れないようにする */
export const roundProb = (x, rng = rnd) => { const f = Math.floor(x); return f + (rng() < x - f ? 1 : 0); };

export function slotScale(rate) { return rate / 100 / slotRtp(); }
/** スロットの配当(賭け金を含む戻りの合計)。rate: 還元率(%) */
export function slotPayout(reels, bet, rate, rng = rnd) { const m = slotMultiplier(reels); return m ? roundProb(bet * m * slotScale(rate), rng) : 0; }

let chinchiroCache;
/** チンチロの、1回の勝負あたりの「勝ちの儲け」と「負けの損」の期待値(賭け金=1)を、全パターンから数える */
export function chinchiroStats() {
  if (chinchiroCache) return chinchiroCache;
  const faces = [1, 2, 3, 4, 5, 6]; const per = new Map(); let none = 0;
  for (const a of faces) for (const b of faces) for (const c of faces) {
    const r = chinchiroRole([a, b, c]); if (!r) { none += 1 / 216; continue; }
    per.set(r.label, { role: r, p: (per.get(r.label)?.p ?? 0) + 1 / 216 });
  }
  const dist = []; // 最大3回で、最終的にその役になる確率
  for (const { role, p } of per.values()) dist.push({ role, p: p * (1 + none + none * none) });
  dist.push({ role: { kind: 'menashi', label: '目なし', strength: 5, mult: 1 }, p: none ** 3 });
  let win = 0, lose = 0;
  for (const P of dist) for (const D of dist) {
    const r = chinchiroCompare({ role: P.role }, { role: D.role });
    if (r.result === 'win') win += P.p * D.p * r.mult; else if (r.result === 'lose') lose += P.p * D.p * r.mult;
  }
  return (chinchiroCache = { win, lose });
}
export const chinchiroScale = (rate) => { const { win, lose } = chinchiroStats(); return (rate / 100 - 1 + lose) / win; };

const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** 標準的な打ち方(17以上で止まる。最初の2枚が9〜11で、親の見せ札が9以下ならダブル)で、N回遊んだときの平均 */
export function bjSimulate(N, seed = 20260101) {
  const rng = seeded(seed); let win = 0, lose = 0;
  for (let n = 0; n < N; n++) {
    let st = bjDeal(1, rng);
    if (!st.done) {
      const up = Math.min(10, Math.floor(st.dealer[0] / 4) + 1);
      const v0 = handValue(st.player).total;
      if (v0 >= 9 && v0 <= 11 && up <= 9) st = bjDouble(st);
      else { while (!st.done) st = handValue(st.player).total >= 17 ? bjStand(st) : bjHit(st); }
    }
    const profit = st.payout - st.bet; // 勝ちは正、負けは負(ダブルは賭け金が2倍)
    if (profit > 0) win += profit; else lose += -profit;
  }
  return { win: win / N, lose: lose / N };
}
/** bjSimulate(3_000_000) の結果を固定した値(実行時に計算しないため)。賭け金=1あたりの、勝ちの儲けと負けの損 */
const BJ_STATS = { win: 0.459087, lose: 0.52352 };
export const bjStats = () => BJ_STATS;
export const bjScale = (rate) => { const { win, lose } = bjStats(); return (rate / 100 - 1 + lose) / win; };
