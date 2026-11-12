import { db, migrate } from '../../core/db.js';

migrate(`
CREATE TABLE IF NOT EXISTS eco_accounts (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  wallet INTEGER NOT NULL DEFAULT 0,        -- 手持ち(犯罪で捕まると、ここから罰金が引かれる)
  bank INTEGER NOT NULL DEFAULT 0,          -- 銀行(罰金の対象外)
  jail_until INTEGER NOT NULL DEFAULT 0,    -- 留置場から出られる時刻
  created_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS eco_cooldowns (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, until INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, key)
);
CREATE TABLE IF NOT EXISTS eco_bj (            -- 進行中のブラックジャック(1人1ゲーム)。再起動しても続けられる
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, msg_id TEXT, state TEXT NOT NULL, started_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS eco_heist (          -- 進行中の大型銀行強盗(1人1ゲーム)。再起動しても続けられる
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, channel_id TEXT, msg_id TEXT,
  state TEXT NOT NULL, deadline INTEGER NOT NULL, started_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_eco_heist_deadline ON eco_heist (deadline);
CREATE TABLE IF NOT EXISTS eco_fines (            -- 罰金の記録(返金できるようにするため。30日で削除)
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
  amount INTEGER NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, refunded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_eco_fines_user ON eco_fines (guild_id, user_id, at);
CREATE TABLE IF NOT EXISTS eco_audit (            -- 管理者の操作の記録(だれが・だれに・何を・いくら)
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  target_id TEXT, action TEXT NOT NULL, amount INTEGER, note TEXT, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eco_audit_guild ON eco_audit (guild_id, at);
CREATE INDEX IF NOT EXISTS idx_eco_accounts_rich ON eco_accounts (guild_id, wallet, bank);
`);

/** 口座を取得する。なければ、初期の所持金つきで作る */
export function account(guildId, userId, startBalance = 0) {
  let a = db.prepare('SELECT * FROM eco_accounts WHERE guild_id=? AND user_id=?').get(guildId, userId);
  if (!a) {
    db.prepare('INSERT INTO eco_accounts (guild_id,user_id,wallet,created_at) VALUES (?,?,?,?)').run(guildId, userId, startBalance, Date.now());
    a = db.prepare('SELECT * FROM eco_accounts WHERE guild_id=? AND user_id=?').get(guildId, userId);
  }
  return a;
}

/** 口座を作らずに見る(なければ、ゼロ) */
export const peek = (g, u) => db.prepare('SELECT * FROM eco_accounts WHERE guild_id=? AND user_id=?').get(g, u) ?? { wallet: 0, bank: 0, jail_until: 0 };

/** 手持ちを増減する。減らす場合に、足りなければ変えずに false(同期処理なので、確認と更新の間に割り込まれない)。
 *  増やす場合は、借金中(マイナス)でも、常に通る */
export function addWallet(guildId, userId, delta) {
  const r = db.prepare('UPDATE eco_accounts SET wallet = wallet + ? WHERE guild_id=? AND user_id=? AND (? >= 0 OR wallet + ? >= 0)').run(delta, guildId, userId, delta, delta);
  return r.changes > 0;
}
/** 手持ちが足りなくても、引く(借金になる)。罰金などに使う */
export function debit(guildId, userId, amount) {
  db.prepare('UPDATE eco_accounts SET wallet = wallet - ? WHERE guild_id=? AND user_id=?').run(amount, guildId, userId);
}
/** 手持ちが足りないときは、持っているぶんだけ引く(罰金用)。引いた額を返す */
export function takeUpTo(guildId, userId, amount) {
  const a = db.prepare('SELECT wallet FROM eco_accounts WHERE guild_id=? AND user_id=?').get(guildId, userId);
  const take = Math.min(Math.max(0, a?.wallet ?? 0), amount);
  if (take > 0) addWallet(guildId, userId, -take);
  return take;
}
export function deposit(guildId, userId, amount) {
  db.exec('BEGIN');
  try {
    const ok = addWallet(guildId, userId, -amount);
    if (ok) db.prepare('UPDATE eco_accounts SET bank = bank + ? WHERE guild_id=? AND user_id=?').run(amount, guildId, userId);
    db.exec('COMMIT'); return ok;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export function withdraw(guildId, userId, amount) {
  db.exec('BEGIN');
  try {
    const r = db.prepare('UPDATE eco_accounts SET bank = bank - ? WHERE guild_id=? AND user_id=? AND bank >= ?').run(amount, guildId, userId, amount);
    if (r.changes) addWallet(guildId, userId, amount);
    db.exec('COMMIT'); return r.changes > 0;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- クールダウン・留置場 ---------- */
export const cooldownLeft = (g, u, key) => Math.max(0, (db.prepare('SELECT until FROM eco_cooldowns WHERE guild_id=? AND user_id=? AND key=?').get(g, u, key)?.until ?? 0) - Date.now());
/** クールダウンを解除する。kind: all / crime / work / beg / heist。解除した件数を返す(終わっているものは数えない) */
export function clearCooldowns(g, u, kind = 'all') {
  const now = Date.now();
  const q = kind === 'all' ? db.prepare('DELETE FROM eco_cooldowns WHERE guild_id=? AND user_id=? AND until>?').run(g, u, now)
    : db.prepare("DELETE FROM eco_cooldowns WHERE guild_id=? AND user_id=? AND until>? AND (key=? OR key LIKE ?)").run(g, u, now, kind, `${kind}:%`);
  return Number(q.changes);
}
export const setCooldown = (g, u, key, ms) => db.prepare(`INSERT INTO eco_cooldowns (guild_id,user_id,key,until) VALUES (?,?,?,?)
  ON CONFLICT(guild_id,user_id,key) DO UPDATE SET until=excluded.until`).run(g, u, key, Date.now() + ms);
export const jailLeft = (g, u) => Math.max(0, (db.prepare('SELECT jail_until FROM eco_accounts WHERE guild_id=? AND user_id=?').get(g, u)?.jail_until ?? 0) - Date.now());
export const jail = (g, u, ms) => db.prepare('UPDATE eco_accounts SET jail_until=? WHERE guild_id=? AND user_id=?').run(Date.now() + ms, g, u);
export const release = (g, u) => db.prepare('UPDATE eco_accounts SET jail_until=0 WHERE guild_id=? AND user_id=?').run(g, u);
/** いま留置場にいる人(残り時間が長い順) */
export const jailed = (g, now = Date.now()) => db.prepare('SELECT user_id, jail_until FROM eco_accounts WHERE guild_id=? AND jail_until > ? ORDER BY jail_until DESC').all(g, now);
/** 全員を釈放する。釈放した人数を返す */
export const releaseAll = (g, now = Date.now()) => Number(db.prepare('UPDATE eco_accounts SET jail_until=0 WHERE guild_id=? AND jail_until > ?').run(g, now).changes);

/* ---------- ランキング(手持ち + 銀行) ---------- */
export const richest = (guildId, limit = 10) =>
  db.prepare('SELECT user_id, wallet, bank, wallet + bank AS total FROM eco_accounts WHERE guild_id=? AND wallet + bank > 0 ORDER BY total DESC, created_at ASC LIMIT ?').all(guildId, limit);

/* ---------- ブラックジャックの進行状況 ---------- */
export const getBj = (g, u) => { const r = db.prepare('SELECT * FROM eco_bj WHERE guild_id=? AND user_id=?').get(g, u); return r && { ...r, state: JSON.parse(r.state) }; };
export const saveBj = (g, u, msgId, state) => db.prepare(`INSERT INTO eco_bj (guild_id,user_id,msg_id,state,started_at) VALUES (?,?,?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET msg_id=excluded.msg_id, state=excluded.state`).run(g, u, msgId, JSON.stringify(state), Date.now());
export const deleteBj = (g, u) => db.prepare('DELETE FROM eco_bj WHERE guild_id=? AND user_id=?').run(g, u);

/* ---------- 大型銀行強盗の進行状況 ---------- */
const heistRow = (r) => r && { ...r, state: JSON.parse(r.state) };
export const getHeist = (g, u) => heistRow(db.prepare('SELECT * FROM eco_heist WHERE guild_id=? AND user_id=?').get(g, u));
export const saveHeist = (g, u, { channelId, msgId, state, deadline }) => db.prepare(`INSERT INTO eco_heist (guild_id,user_id,channel_id,msg_id,state,deadline,started_at) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET channel_id=COALESCE(excluded.channel_id, channel_id), msg_id=COALESCE(excluded.msg_id, msg_id), state=excluded.state`).run(g, u, channelId ?? null, msgId ?? null, JSON.stringify(state), deadline, Date.now());
export const setHeistDeadline = (g, u, deadline) => db.prepare('UPDATE eco_heist SET deadline=? WHERE guild_id=? AND user_id=?').run(deadline, g, u);
/** ゲームを終わらせる。取れたら、そのゲームを返す(同時に2か所から終わらせても、片方しか取れない=二重に精算されない) */
export const claimHeist = (g, u) => heistRow(db.prepare('DELETE FROM eco_heist WHERE guild_id=? AND user_id=? RETURNING *').get(g, u));
export const expiredHeists = (now = Date.now()) => db.prepare('SELECT guild_id, user_id FROM eco_heist WHERE deadline < ?').all(now);

/* ---------- 罰金の記録・返金・管理者の操作の記録 ---------- */
db.prepare('DELETE FROM eco_fines WHERE at < ?').run(Date.now() - 30 * 864e5); // 30日より古い罰金の記録は消す
export const logFine = (g, u, amount, kind) => db.prepare('INSERT INTO eco_fines (guild_id,user_id,amount,kind,at) VALUES (?,?,?,?,?)').run(g, u, amount, kind, Date.now());
/** 返金できる罰金(犯罪・大型銀行)。新しい順 */
export const recentFines = (g, u, limit = 10) => db.prepare("SELECT id, amount, kind, at, refunded FROM eco_fines WHERE guild_id=? AND user_id=? AND kind IN ('crime','heist') ORDER BY at DESC, id DESC LIMIT ?").all(g, u, limit);
/** 罰金を返金済みにする。取れたら、その罰金を返す(同時に2回押されても、片方しか取れない=二重に返金されない) */
export const claimFineRefund = (g, id) => db.prepare("UPDATE eco_fines SET refunded=1 WHERE id=? AND guild_id=? AND refunded=0 AND kind IN ('crime','heist') RETURNING *").get(id, g);
export const audit = (g, actor, target, action, amount, note) => db.prepare('INSERT INTO eco_audit (guild_id,actor_id,actor_name,target_id,action,amount,note,at) VALUES (?,?,?,?,?,?,?,?)')
  .run(g, actor.id, String(actor.name ?? actor.id).slice(0, 80), target ?? null, action, amount ?? null, note ? String(note).slice(0, 200) : null, Date.now());
export const recentAudit = (g, limit = 20) => db.prepare('SELECT * FROM eco_audit WHERE guild_id=? ORDER BY at DESC, id DESC LIMIT ?').all(g, limit);

/** 管理者による残高の調整。target: 'wallet' | 'bank'、mode: 'add' | 'subtract' | 'set'。
 *  借金を許可していなければ、手持ちも0未満にならない。銀行は、常に0未満にならない。新しい残高を返す */
export function adjustBalance(g, u, { target, mode, amount, allowDebt }) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO eco_accounts (guild_id,user_id,wallet,created_at) VALUES (?,?,0,?)').run(g, u, Date.now());
    const col = target === 'bank' ? 'bank' : 'wallet';
    const cur = db.prepare(`SELECT ${col} AS v FROM eco_accounts WHERE guild_id=? AND user_id=?`).get(g, u).v;
    let next = mode === 'add' ? cur + amount : mode === 'subtract' ? cur - amount : amount;
    if (col === 'bank' || !allowDebt) next = Math.max(0, next);
    db.prepare(`UPDATE eco_accounts SET ${col}=? WHERE guild_id=? AND user_id=?`).run(next, g, u);
    db.exec('COMMIT');
    return peek(g, u);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
