import { db, migrate } from '../../core/db.js';
import { addWallet, takeUpTo, debit } from './db.js';

/**
 * お金の出し入れ。サーバーの予算(国庫)がオンのときは、
 *   報酬・配当・初期の所持金は、予算から支払う(足りなければ、ある分だけ)
 *   罰金・賭け金・保釈金は、予算に入る
 * オフのときは、予算に関係なく、お金が増えたり減ったりする
 */
migrate('CREATE TABLE IF NOT EXISTS eco_budget (guild_id TEXT PRIMARY KEY, balance INTEGER NOT NULL DEFAULT 0)');

export const treasury = (g) => db.prepare('SELECT balance FROM eco_budget WHERE guild_id=?').get(g)?.balance ?? 0;
export const setTreasury = (g, n) => db.prepare('INSERT INTO eco_budget (guild_id,balance) VALUES (?,?) ON CONFLICT(guild_id) DO UPDATE SET balance=excluded.balance').run(g, Math.max(0, Math.floor(n)));
export const addTreasury = (g, d) => db.prepare('INSERT INTO eco_budget (guild_id,balance) VALUES (?,MAX(0,?)) ON CONFLICT(guild_id) DO UPDATE SET balance=MAX(0, balance+?)').run(g, d, d);

/** サーバー全体で、いま出回っているお金(手持ち + 銀行)と、口座の数 */
export const circulation = (g) => db.prepare('SELECT COALESCE(SUM(wallet+bank),0) AS total, COUNT(*) AS accounts FROM eco_accounts WHERE guild_id=?').get(g);

/** 口座を取得する。なければ作る(初期の所持金つき。予算がオンなら、予算の範囲で) */
export function ensureAccount(g, u, s) {
  const row = () => db.prepare('SELECT * FROM eco_accounts WHERE guild_id=? AND user_id=?').get(g, u);
  let a = row(); if (a) return a;
  db.exec('BEGIN');
  try {
    let start = s.startBalance;
    if (s.budgetEnabled) { start = Math.min(start, treasury(g)); if (start > 0) addTreasury(g, -start); }
    db.prepare('INSERT OR IGNORE INTO eco_accounts (guild_id,user_id,wallet,created_at) VALUES (?,?,?,?)').run(g, u, start, Date.now());
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return row();
}

/** プレイヤーへ支払う。戻り値: { paid: 実際に払えた額, short: 予算が足りず、払えなかった額 } */
export function pay(g, u, amount, s) {
  if (amount <= 0) return { paid: 0, short: 0 };
  if (!s.budgetEnabled) { addWallet(g, u, amount); return { paid: amount, short: 0 }; }
  db.exec('BEGIN');
  try {
    const give = Math.min(amount, treasury(g));
    if (give > 0) { addTreasury(g, -give); addWallet(g, u, give); }
    db.exec('COMMIT'); return { paid: give, short: amount - give };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/** プレイヤーから集める(賭け金・保釈金)。手持ちが足りなければ false */
export function collect(g, u, amount, s) {
  db.exec('BEGIN');
  try {
    const ok = addWallet(g, u, -amount);
    if (ok && s.budgetEnabled) addTreasury(g, amount);
    db.exec('COMMIT'); return ok;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/** 罰金。借金を許可しているときは、全額を引く(所持金がマイナスになることがある)。許可していないときは、持っているぶんだけ。引いた額を返す */
export function fine(g, u, amount, s) {
  db.exec('BEGIN');
  try {
    let took;
    if (s.allowDebt) { debit(g, u, amount); took = amount; } else took = takeUpTo(g, u, amount);
    if (took > 0 && s.budgetEnabled) addTreasury(g, took);
    db.exec('COMMIT'); return took;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
