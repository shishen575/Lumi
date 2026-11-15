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
CREATE TABLE IF NOT EXISTS eco_items (            -- 闇マーケットで買った道具
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, item TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, item)
);
CREATE TABLE IF NOT EXISTS eco_jobs (             -- 職業ごとの出勤回数(昇進に使う)
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, job TEXT NOT NULL, shifts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, job)
);
CREATE TABLE IF NOT EXISTS eco_wanted (           -- 指名手配の手配度(時間で下がる。下がった分は、読むときに計算する)
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, heat INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS eco_ramen (            -- 進行中のラーメン屋のバイト(1人1ゲーム)。再起動しても続けられる
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, state TEXT NOT NULL, deadline INTEGER NOT NULL, started_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS eco_status (           -- お店の消耗品の効果(タバコ・お酒の枠ごとに1つ)
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, slot TEXT NOT NULL, item TEXT NOT NULL, until INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, slot)
);
CREATE TABLE IF NOT EXISTS eco_pets (              -- ペット(1人で、何匹でも。飼える数は、不動産で増える)
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, species TEXT NOT NULL, name TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0, hunger INTEGER NOT NULL DEFAULT 80, fed_at INTEGER NOT NULL, adopted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS eco_pets_user ON eco_pets (guild_id, user_id);
CREATE TABLE IF NOT EXISTS eco_stock_prices (     -- 株価の履歴(時刻ごと)。最新の行が、いまの株価
  guild_id TEXT NOT NULL, company TEXT NOT NULL, tick INTEGER NOT NULL, price REAL NOT NULL,
  PRIMARY KEY (guild_id, company, tick)
);
CREATE TABLE IF NOT EXISTS eco_news (             -- 株のニュース(新聞チャンネルに出す)。出したら posted = 1
  guild_id TEXT NOT NULL, company TEXT NOT NULL, tick INTEGER NOT NULL, up INTEGER NOT NULL, text TEXT NOT NULL, before_px REAL NOT NULL, after_px REAL NOT NULL, posted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, company, tick)
);
CREATE TABLE IF NOT EXISTS eco_stock_holdings (   -- 持っている株
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, company TEXT NOT NULL, shares INTEGER NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, company)
);
CREATE TABLE IF NOT EXISTS eco_lottery_tickets (   -- 買ったくじ(くじの種類・回・番号ごと。price = 買ったときのくじ代)
  guild_id TEXT NOT NULL, lottery TEXT NOT NULL, round INTEGER NOT NULL, user_id TEXT NOT NULL, number INTEGER NOT NULL, price INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (guild_id, lottery, round, user_id, number, price)
);
CREATE TABLE IF NOT EXISTS eco_lottery_state (     -- ジャックポット(サーバー・くじの種類ごと)
  guild_id TEXT NOT NULL, lottery TEXT NOT NULL, jackpot INTEGER NOT NULL, PRIMARY KEY (guild_id, lottery)
);
CREATE TABLE IF NOT EXISTS eco_lottery_draws (     -- 抽選の結果の記録
  guild_id TEXT NOT NULL, lottery TEXT NOT NULL, round INTEGER NOT NULL, winning INTEGER NOT NULL, jackpot INTEGER NOT NULL, jackpot_won INTEGER NOT NULL,
  tickets INTEGER NOT NULL, sales INTEGER NOT NULL, paid INTEGER NOT NULL, winners TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, lottery, round)
);
CREATE TABLE IF NOT EXISTS eco_estate (            -- 持っている物件(種類ごとの数と、買った値段の合計)
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, property TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, spent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, property)
);
CREATE TABLE IF NOT EXISTS eco_estate_rent (       -- 家賃を最後に受け取った(または、物件を買った・売った)時刻
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id)
);
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
/** 手持ちを、他の人に送る。足りなければ false(同期処理+トランザクションで、二重に送られたり、片方だけ動いたりしない) */
export function transfer(g, from, to, amount) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO eco_accounts (guild_id,user_id,wallet,created_at) VALUES (?,?,0,?)').run(g, to, Date.now());
    if (!addWallet(g, from, -amount)) { db.exec('ROLLBACK'); return false; }
    addWallet(g, to, amount);
    db.exec('COMMIT');
    return true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
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

/** サーバー全員の持ち物(ダッシュボードの一覧用)。お金(手持ち+銀行)も、いっしょに */
export function allHoldings(g, now = Date.now()) {
  const by = (sql, ...a) => db.prepare(sql).all(g, ...a);
  return {
    accounts: by('SELECT user_id, wallet, bank FROM eco_accounts WHERE guild_id=?'),
    items: by('SELECT user_id, item, qty FROM eco_items WHERE guild_id=? AND qty>0'),
    status: by('SELECT user_id, slot, item, until FROM eco_status WHERE guild_id=? AND until>?', now),
    pets: by('SELECT user_id, species, name, xp FROM eco_pets WHERE guild_id=? ORDER BY id'),
    estate: by('SELECT user_id, property, count FROM eco_estate WHERE guild_id=? AND count>0'),
    stocks: by('SELECT user_id, company, shares FROM eco_stock_holdings WHERE guild_id=? AND shares>0'),
  };
}
/** お金持ちランキング(ページごと)。全体の人数も返す */
export const richestPage = (guildId, offset = 0, limit = 10) => ({
  rows: db.prepare('SELECT user_id, wallet, bank, wallet + bank AS total FROM eco_accounts WHERE guild_id=? AND wallet + bank > 0 ORDER BY total DESC, created_at ASC LIMIT ? OFFSET ?').all(guildId, limit, offset),
  count: db.prepare('SELECT COUNT(*) c FROM eco_accounts WHERE guild_id=? AND wallet + bank > 0').get(guildId).c,
});

/* ---------- ブラックジャックの進行状況 ---------- */
export const getBj = (g, u) => { const r = db.prepare('SELECT * FROM eco_bj WHERE guild_id=? AND user_id=?').get(g, u); return r && { ...r, state: JSON.parse(r.state) }; };
export const saveBj = (g, u, msgId, state) => db.prepare(`INSERT INTO eco_bj (guild_id,user_id,msg_id,state,started_at) VALUES (?,?,?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET msg_id=excluded.msg_id, state=excluded.state`).run(g, u, msgId, JSON.stringify(state), Date.now());
/** 進行中のブラックジャックを、すべて(サーバー単位) */
export const allBj = (g) => db.prepare('SELECT * FROM eco_bj WHERE guild_id=?').all(g).map((r) => ({ ...r, state: JSON.parse(r.state) }));
/** ゲームを終わらせる。取れたら、そのゲームを返す(同時に2か所から終わらせても、片方しか取れない=二重に返金されない) */
export const claimBj = (g, u) => { const r = db.prepare('DELETE FROM eco_bj WHERE guild_id=? AND user_id=? RETURNING *').get(g, u); return r && { ...r, state: JSON.parse(r.state) }; };
export const deleteBj = (g, u) => db.prepare('DELETE FROM eco_bj WHERE guild_id=? AND user_id=?').run(g, u);

/* ---------- 大型銀行強盗の進行状況 ---------- */
const heistRow = (r) => r && { ...r, state: JSON.parse(r.state) };
export const getHeist = (g, u) => heistRow(db.prepare('SELECT * FROM eco_heist WHERE guild_id=? AND user_id=?').get(g, u));
export const saveHeist = (g, u, { channelId, msgId, state, deadline }) => db.prepare(`INSERT INTO eco_heist (guild_id,user_id,channel_id,msg_id,state,deadline,started_at) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET channel_id=COALESCE(excluded.channel_id, channel_id), msg_id=COALESCE(excluded.msg_id, msg_id), state=excluded.state`).run(g, u, channelId ?? null, msgId ?? null, JSON.stringify(state), deadline, Date.now());
// 再起動で止まっている間は、大型銀行の制限時間を進めない(再起動をまたいだ人が、時間切れで罰金にならないように)
try { db.exec('ALTER TABLE eco_heist ADD COLUMN paused_left INTEGER'); } catch { /* exists */ }
/** 止まる直前: 進行中の強盗の「残り時間」を記録する */
export const pauseHeists = (now = Date.now()) => Number(db.prepare('UPDATE eco_heist SET paused_left = MAX(0, deadline - ?)').run(now).changes);
/** 起動したとき: 記録した残り時間から、制限時間を数え直す(最低でも minMs は残す)。数え直した件数を返す */
export const resumeHeists = (now = Date.now(), minMs = 10_000) => Number(db.prepare('UPDATE eco_heist SET deadline = ? + MAX(paused_left, ?), paused_left = NULL WHERE paused_left IS NOT NULL').run(now, minMs).changes);
/* ---------- 闇マーケットの道具 ---------- */
export const itemQty = (g, u, item) => db.prepare('SELECT qty FROM eco_items WHERE guild_id=? AND user_id=? AND item=?').get(g, u, item)?.qty ?? 0;
export const allItems = (g, u) => Object.fromEntries(db.prepare('SELECT item, qty FROM eco_items WHERE guild_id=? AND user_id=? AND qty>0').all(g, u).map((r) => [r.item, r.qty]));
export const addItem = (g, u, item, n = 1) => db.prepare(`INSERT INTO eco_items (guild_id,user_id,item,qty) VALUES (?,?,?,?)
  ON CONFLICT(guild_id,user_id,item) DO UPDATE SET qty=qty+excluded.qty`).run(g, u, item, n);
/** 道具を、ほかの人に渡す。渡せたら 'ok'、持っている数が足りなければ 'short'、相手が持てる上限を超えるなら 'full'(途中で止まっても、片方だけ減ったり増えたりしない) */
export function transferItem(g, from, to, item, n, maxStack) {
  db.exec('BEGIN');
  try {
    if (itemQty(g, to, item) + n > maxStack) { db.exec('ROLLBACK'); return 'full'; }
    if (!db.prepare('UPDATE eco_items SET qty=qty-? WHERE guild_id=? AND user_id=? AND item=? AND qty>=? RETURNING qty').get(n, g, from, item, n)) { db.exec('ROLLBACK'); return 'short'; }
    addItem(g, to, item, n); db.exec('COMMIT'); return 'ok';
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/** 道具を1つ使う。あれば true(同時に2回使っても、1つしかなければ、片方しか通らない) */
export const useItem = (g, u, item) => !!db.prepare('UPDATE eco_items SET qty=qty-1 WHERE guild_id=? AND user_id=? AND item=? AND qty>=1 RETURNING qty').get(g, u, item);
/* ---------- 職業の出勤回数 ---------- */
export const shiftsOf = (g, u, job) => db.prepare('SELECT shifts FROM eco_jobs WHERE guild_id=? AND user_id=? AND job=?').get(g, u, job)?.shifts ?? 0;
export const allShifts = (g, u) => Object.fromEntries(db.prepare('SELECT job, shifts FROM eco_jobs WHERE guild_id=? AND user_id=?').all(g, u).map((r) => [r.job, r.shifts]));
/** 出勤を1回増やして、新しい回数を返す */
export const addShift = (g, u, job) => db.prepare(`INSERT INTO eco_jobs (guild_id,user_id,job,shifts) VALUES (?,?,?,1)
  ON CONFLICT(guild_id,user_id,job) DO UPDATE SET shifts=shifts+1 RETURNING shifts`).get(g, u, job).shifts;

/* ---------- 指名手配 ---------- */
const decayed = (row, decayMin, now) => (row ? Math.max(0, row.heat - Math.floor((now - row.at) / (Math.max(1, decayMin) * 60_000))) : 0);
export const getHeat = (g, u, decayMin = 30, now = Date.now()) => decayed(db.prepare('SELECT heat, at FROM eco_wanted WHERE guild_id=? AND user_id=?').get(g, u), decayMin, now);
/** 手配度を増やす(上限 max)。増やしたあとの手配度を返す */
export function addHeat(g, u, delta, decayMin = 30, max = 30, now = Date.now()) {
  const next = Math.min(max, getHeat(g, u, decayMin, now) + delta);
  db.prepare(`INSERT INTO eco_wanted (guild_id,user_id,heat,at) VALUES (?,?,?,?)
    ON CONFLICT(guild_id,user_id) DO UPDATE SET heat=excluded.heat, at=excluded.at`).run(g, u, next, now);
  return next;
}
export const clearHeat = (g, u) => db.prepare('DELETE FROM eco_wanted WHERE guild_id=? AND user_id=?').run(g, u);
/** 手配度が minHeat 以上の人(高い順) */
export const topWanted = (g, decayMin = 30, minHeat = 5, limit = 10, now = Date.now()) =>
  db.prepare('SELECT user_id, heat, at FROM eco_wanted WHERE guild_id=?').all(g)
    .map((r) => ({ user_id: r.user_id, heat: decayed(r, decayMin, now) })).filter((r) => r.heat >= minHeat)
    .sort((a, b) => b.heat - a.heat).slice(0, limit);
/* ---------- ラーメン屋のバイトの進行状況 ---------- */
const ramenRow = (r) => r && { ...r, state: JSON.parse(r.state) };
export const getRamen = (g, u) => ramenRow(db.prepare('SELECT * FROM eco_ramen WHERE guild_id=? AND user_id=?').get(g, u));
export const saveRamen = (g, u, state, deadline) => db.prepare(`INSERT INTO eco_ramen (guild_id,user_id,state,deadline,started_at) VALUES (?,?,?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET state=excluded.state`).run(g, u, JSON.stringify(state), deadline, Date.now());
/** ゲームを終わらせる。取れたら、そのゲームを返す(同時に2か所から終わらせても、片方しか取れない=二重に給料が出ない) */
export const claimRamen = (g, u) => ramenRow(db.prepare('DELETE FROM eco_ramen WHERE guild_id=? AND user_id=? RETURNING *').get(g, u));
/* ---------- お店の消耗品の効果 ---------- */
export const setStatus = (g, u, slot, item, until) => db.prepare(`INSERT INTO eco_status (guild_id,user_id,slot,item,until) VALUES (?,?,?,?,?)
  ON CONFLICT(guild_id,user_id,slot) DO UPDATE SET item=excluded.item, until=excluded.until`).run(g, u, slot, item, until);
export const activeStatuses = (g, u, now = Date.now()) => db.prepare('SELECT slot, item, until FROM eco_status WHERE guild_id=? AND user_id=? AND until>?').all(g, u, now);
/* ---------- ペット ---------- */
// 昔のデータ(1人1匹・idなし)を、新しい形に移す(1回だけ)
if (!db.prepare("SELECT 1 FROM pragma_table_info('eco_pets') WHERE name='id'").get()) {
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE eco_pets RENAME TO eco_pets_old');
    db.exec('CREATE TABLE eco_pets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, species TEXT NOT NULL, name TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, hunger INTEGER NOT NULL DEFAULT 80, fed_at INTEGER NOT NULL, adopted_at INTEGER NOT NULL)');
    db.exec('INSERT INTO eco_pets (guild_id,user_id,species,name,xp,hunger,fed_at,adopted_at) SELECT guild_id,user_id,species,name,xp,hunger,fed_at,adopted_at FROM eco_pets_old');
    db.exec('DROP TABLE eco_pets_old'); db.exec('CREATE INDEX IF NOT EXISTS eco_pets_user ON eco_pets (guild_id, user_id)');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
/** そのユーザーのペット(飼った順。番号は、この並びの1から) */
export const getPets = (g, u) => db.prepare('SELECT * FROM eco_pets WHERE guild_id=? AND user_id=? ORDER BY id').all(g, u);
export const adoptPet = (g, u, species, name, now = Date.now()) => Number(db.prepare('INSERT INTO eco_pets (guild_id,user_id,species,name,xp,hunger,fed_at,adopted_at) VALUES (?,?,?,?,0,80,?,?)').run(g, u, species, name, now, now).lastInsertRowid);
export const renamePet = (id, name) => db.prepare('UPDATE eco_pets SET name=? WHERE id=?').run(name, id);
export const releasePet = (id) => Number(db.prepare('DELETE FROM eco_pets WHERE id=?').run(id).changes) > 0;
/** 満腹度(いまの値 = hunger)と、なつき度を更新する。fed_at を now にして、そこから減り始める */
export const updatePet = (id, { hunger, xpAdd = 0 }, now = Date.now()) => db.prepare('UPDATE eco_pets SET hunger=?, xp=xp+?, fed_at=? WHERE id=?').run(hunger, xpAdd, now, id);
/* ---------- 株 ---------- */
export const lastStockRow = (g, company) => db.prepare('SELECT tick, price FROM eco_stock_prices WHERE guild_id=? AND company=? ORDER BY tick DESC LIMIT 1').get(g, company) ?? null;
export const addNews = (g, company, tick, up, text, before, after) => db.prepare('INSERT OR IGNORE INTO eco_news (guild_id,company,tick,up,text,before_px,after_px) VALUES (?,?,?,?,?,?,?)').run(g, company, tick, up ? 1 : 0, text, before, after);
/** まだ出していないニュース(古い順)。fromTick より前のものは、出さずに済ませる(止まっていたあとに、どっと出ないように) */
export function takeNews(g, fromTick, limit = 20) {
  db.prepare('UPDATE eco_news SET posted=1 WHERE guild_id=? AND posted=0 AND tick<?').run(g, fromTick);
  const rows = db.prepare('SELECT * FROM eco_news WHERE guild_id=? AND posted=0 ORDER BY tick ASC LIMIT ?').all(g, limit);
  for (const r of rows) db.prepare('UPDATE eco_news SET posted=1 WHERE guild_id=? AND company=? AND tick=?').run(g, r.company, r.tick);
  db.prepare('DELETE FROM eco_news WHERE guild_id=? AND tick<?').run(g, Date.now() / 60000 - 7 * 1440);
  return rows;
}
export const firstStockRow = (g, company) => db.prepare('SELECT tick, price FROM eco_stock_prices WHERE guild_id=? AND company=? ORDER BY tick ASC LIMIT 1').get(g, company) ?? null;
export const stockPriceAt = (g, company, tick) => db.prepare('SELECT price FROM eco_stock_prices WHERE guild_id=? AND company=? AND tick<=? ORDER BY tick DESC LIMIT 1').get(g, company, tick)?.price ?? null;
export const stockRange = (g, company, fromTick) => db.prepare('SELECT MIN(price) lo, MAX(price) hi FROM eco_stock_prices WHERE guild_id=? AND company=? AND tick>=?').get(g, company, fromTick);
export const insertStockPrices = (g, company, rows, keepFromTick) => {
  db.exec('BEGIN');
  try {
    const st = db.prepare('INSERT OR REPLACE INTO eco_stock_prices (guild_id,company,tick,price) VALUES (?,?,?,?)');
    for (const r of rows) st.run(g, company, r.tick, r.price);
    db.prepare('DELETE FROM eco_stock_prices WHERE guild_id=? AND company=? AND tick<?').run(g, company, keepFromTick);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
};
export const holdings = (g, u) => db.prepare('SELECT company, shares, cost FROM eco_stock_holdings WHERE guild_id=? AND user_id=? AND shares>0').all(g, u);
export const holding = (g, u, company) => db.prepare('SELECT shares, cost FROM eco_stock_holdings WHERE guild_id=? AND user_id=? AND company=?').get(g, u, company) ?? { shares: 0, cost: 0 };
export const addHolding = (g, u, company, shares, cost) => db.prepare(`INSERT INTO eco_stock_holdings (guild_id,user_id,company,shares,cost) VALUES (?,?,?,?,?)
  ON CONFLICT(guild_id,user_id,company) DO UPDATE SET shares=shares+excluded.shares, cost=cost+excluded.cost`).run(g, u, company, shares, cost);
/** 株を売る(持っている数を超えない)。売れたら、売った分の元の値(取得費)を返す。取れなければ null(同時に2回売っても、二重に売れない) */
export function takeHolding(g, u, company, shares) {
  const cur = holding(g, u, company);
  const r = db.prepare('UPDATE eco_stock_holdings SET shares=shares-?, cost=cost-? WHERE guild_id=? AND user_id=? AND company=? AND shares>=?').run(shares, Math.round(cur.cost * shares / Math.max(1, cur.shares)), g, u, company, shares);
  return Number(r.changes) > 0 ? Math.round(cur.cost * shares / Math.max(1, cur.shares)) : null;
}
/* ---------- 宝くじ(くじの種類 = lottery ごと) ---------- */
export const lotteryJackpot = (g, lot, base) => db.prepare('SELECT jackpot FROM eco_lottery_state WHERE guild_id=? AND lottery=?').get(g, lot)?.jackpot ?? base;
export const setLotteryJackpot = (g, lot, v) => db.prepare('INSERT INTO eco_lottery_state (guild_id,lottery,jackpot) VALUES (?,?,?) ON CONFLICT(guild_id,lottery) DO UPDATE SET jackpot=excluded.jackpot').run(g, lot, v);
export const addTicket = (g, lot, round, u, number, price, qty) => db.prepare(`INSERT INTO eco_lottery_tickets (guild_id,lottery,round,user_id,number,price,qty) VALUES (?,?,?,?,?,?,?)
  ON CONFLICT(guild_id,lottery,round,user_id,number,price) DO UPDATE SET qty=qty+excluded.qty`).run(g, lot, round, u, number, price, qty);
export const userTickets = (g, lot, round, u) => db.prepare('SELECT number, qty FROM eco_lottery_tickets WHERE guild_id=? AND lottery=? AND round=? AND user_id=? ORDER BY number').all(g, lot, round, u);
export const userTicketCount = (g, lot, round, u) => db.prepare('SELECT COALESCE(SUM(qty),0) c FROM eco_lottery_tickets WHERE guild_id=? AND lottery=? AND round=? AND user_id=?').get(g, lot, round, u).c;
export const roundSales = (g, lot, round) => db.prepare('SELECT COALESCE(SUM(qty),0) c FROM eco_lottery_tickets WHERE guild_id=? AND lottery=? AND round=?').get(g, lot, round).c;
/** 締め切った回のくじを、まとめて取り出して消す(取れたときだけ精算する = 二重に払わない) */
export const claimLotteryRounds = (g, lot, upToRound) => db.prepare('DELETE FROM eco_lottery_tickets WHERE guild_id=? AND lottery=? AND round<=? RETURNING round, user_id, number, qty, price').all(g, lot, upToRound);
/** 設定から消されたくじの、売れ残り(払い戻し用)。keepIds 以外のくじを、すべて取り出して消す */
export const claimOrphanTickets = (g, keepIds) => db.prepare(`DELETE FROM eco_lottery_tickets WHERE guild_id=? AND lottery NOT IN (${keepIds.map(() => '?').join(',') || "''"}) RETURNING user_id, qty, price`).all(g, ...keepIds);
export const pendingLotteryGuilds = () => db.prepare('SELECT DISTINCT guild_id FROM eco_lottery_tickets').all().map((r) => r.guild_id);
export const recordDraw = (g, lot, r) => db.prepare('INSERT OR REPLACE INTO eco_lottery_draws (guild_id,lottery,round,winning,jackpot,jackpot_won,tickets,sales,paid,winners,at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(g, lot, r.round, r.winning, r.jackpot, r.jackpotWon ? 1 : 0, r.tickets, r.sales, r.paid, JSON.stringify(r.winners), Date.now());
export const lastDraw = (g, lot) => { const r = db.prepare('SELECT * FROM eco_lottery_draws WHERE guild_id=? AND lottery=? ORDER BY round DESC LIMIT 1').get(g, lot); return r && { ...r, winners: JSON.parse(r.winners) }; };
/* ---------- 不動産 ---------- */
export const estateHoldings = (g, u) => db.prepare('SELECT property, count, spent FROM eco_estate WHERE guild_id=? AND user_id=? AND count>0').all(g, u);
export const estateCount = (g, u, property) => db.prepare('SELECT count, spent FROM eco_estate WHERE guild_id=? AND user_id=? AND property=?').get(g, u, property) ?? { count: 0, spent: 0 };
export const addEstate = (g, u, property, count, spent) => db.prepare(`INSERT INTO eco_estate (guild_id,user_id,property,count,spent) VALUES (?,?,?,?,?)
  ON CONFLICT(guild_id,user_id,property) DO UPDATE SET count=count+excluded.count, spent=spent+excluded.spent`).run(g, u, property, count, spent);
/** 物件を売る(持っている数を超えない)。売れたら、売った分の元の値(買った値段の合計のうち、その数ぶん)を返す。取れなければ null */
export function takeEstate(g, u, property, n) {
  const cur = estateCount(g, u, property); if (cur.count < n) return null;
  const basis = Math.round(cur.spent * n / cur.count);
  const r = db.prepare('UPDATE eco_estate SET count=count-?, spent=spent-? WHERE guild_id=? AND user_id=? AND property=? AND count>=?').run(n, basis, g, u, property, n);
  return Number(r.changes) > 0 ? basis : null;
}
export const rentAt = (g, u) => db.prepare('SELECT at FROM eco_estate_rent WHERE guild_id=? AND user_id=?').get(g, u)?.at ?? null;
export const setRentAt = (g, u, at) => db.prepare('INSERT INTO eco_estate_rent (guild_id,user_id,at) VALUES (?,?,?) ON CONFLICT(guild_id,user_id) DO UPDATE SET at=excluded.at').run(g, u, at);
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
