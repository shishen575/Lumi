import { getKV, setKV } from '../../core/db.js';

// サーバーごとの設定。既定はオフ(管理者がダッシュボードでオンにする)
export const DEFAULTS = {
  enabled: false, currencyName: 'コイン', currencyEmoji: '🪙', startBalance: 1000, maxBet: 100000,
  payoutRate: 95,        // ギャンブルの還元率(%)。賭け金に対して、平均でどれだけ戻るか(50〜150)
  budgetEnabled: false,  // サーバーの予算を使うか。オンのとき、報酬・配当は予算から支払われ、罰金・負けは予算に入る
  allowDebt: true,       // 借金を許可するか。許可すると、罰金などで、所持金が0より下になる(0以下の間は、犯罪ができない)
};
const clamp = (v, lo, hi, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

export const getSettings = (guildId) => ({ ...DEFAULTS, ...getKV(guildId, 'economy', {}) });
export function saveSettings(guildId, s) {
  const cur = getSettings(guildId);
  const next = {
    enabled: s.enabled === undefined ? cur.enabled : !!s.enabled,
    currencyName: s.currencyName === undefined ? cur.currencyName : (String(s.currencyName).trim().slice(0, 10) || DEFAULTS.currencyName),
    currencyEmoji: s.currencyEmoji === undefined ? cur.currencyEmoji : (String(s.currencyEmoji).trim().slice(0, 40) || DEFAULTS.currencyEmoji),
    startBalance: s.startBalance === undefined ? cur.startBalance : clamp(s.startBalance, 0, 1_000_000, DEFAULTS.startBalance),
    maxBet: s.maxBet === undefined ? cur.maxBet : clamp(s.maxBet, 10, 1_000_000_000, DEFAULTS.maxBet),
    payoutRate: s.payoutRate === undefined ? cur.payoutRate : clamp(s.payoutRate, 50, 150, DEFAULTS.payoutRate),
    budgetEnabled: s.budgetEnabled === undefined ? cur.budgetEnabled : !!s.budgetEnabled,
    allowDebt: s.allowDebt === undefined ? cur.allowDebt : !!s.allowDebt,
  };
  setKV(guildId, 'economy', next);
  return next;
}
export const money = (s, n) => `${s.currencyEmoji} ${Number(n).toLocaleString()}`;
