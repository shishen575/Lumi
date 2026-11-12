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
export const setCooldown = (g, u, key, ms) => db.prepare(`INSERT INTO eco_cooldowns (guild_id,user_id,key,until) VALUES (?,?,?,?)
  ON CONFLICT(guild_id,user_id,key) DO UPDATE SET until=excluded.until`).run(g, u, key, Date.now() + ms);
export const jailLeft = (g, u) => Math.max(0, (db.prepare('SELECT jail_until FROM eco_accounts WHERE guild_id=? AND user_id=?').get(g, u)?.jail_until ?? 0) - Date.now());
export const jail = (g, u, ms) => db.prepare('UPDATE eco_accounts SET jail_until=? WHERE guild_id=? AND user_id=?').run(Date.now() + ms, g, u);
export const release = (g, u) => db.prepare('UPDATE eco_accounts SET jail_until=0 WHERE guild_id=? AND user_id=?').run(g, u);

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
/** ゲームを終わらせる。取れたら、そのゲームを返す(同時に2か所から終わらせても、片方しか取れない=二重に精算されない) */
export const claimHeist = (g, u) => heistRow(db.prepare('DELETE FROM eco_heist WHERE guild_id=? AND user_id=? RETURNING *').get(g, u));
export const expiredHeists = (now = Date.now()) => db.prepare('SELECT guild_id, user_id FROM eco_heist WHERE deadline < ?').all(now);
