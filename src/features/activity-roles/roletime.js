import { AuditLogEvent } from 'discord.js';
import { db, migrate, getKV, setKV } from '../../core/db.js';
import { getRules, getSettings } from './db.js';

/**
 * ロールを取った(外れた)時刻の記録と、ロールからロールまでの、達成時間の集計。
 *  ・記録するのは、このBOTが、動き始めてから(Discordは、「いつ取ったか」を、持っていない)。それ以前は、「不明」
 *  ・だれが付けても(BOT・手動・ほかのBOT)、ロールの付け外しを、記録する
 *  ・監査ログに残っている分(約45日)は、あとから、取り込める(正確な時刻)
 */
migrate(`CREATE TABLE IF NOT EXISTS role_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL,
  at INTEGER NOT NULL, action TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'live',
  UNIQUE (guild_id, user_id, role_id, at, action))`);
migrate('CREATE INDEX IF NOT EXISTS role_log_role ON role_log (guild_id, role_id, action)');
migrate('CREATE INDEX IF NOT EXISTS role_log_user ON role_log (guild_id, user_id)');
migrate(`CREATE TABLE IF NOT EXISTS role_seen (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (guild_id, user_id, role_id))`);

const log = (g, u, r, at, action, source) => db.prepare('INSERT OR IGNORE INTO role_log (guild_id, user_id, role_id, at, action, source) VALUES (?,?,?,?,?,?)').run(g, u, r, at, action, source);
export const trackingSince = (g) => getKV(g, 'role_log_since', null);

/**
 * メンバー1人の、いまのロールと、前に見たロールを比べて、増えた・減ったを、記録する。
 * init = true: 初回の同期(いまあるロールは、取った時刻が、分からないので、記録せず、「見た」とだけ、しておく)
 */
export function syncMemberRoles(g, member, { now = Date.now(), source = 'live', init = false } = {}) {
  const current = new Set([...member.roles.cache.keys()].filter((id) => id !== g));
  const seen = new Set(db.prepare('SELECT role_id FROM role_seen WHERE guild_id=? AND user_id=?').all(g, member.id).map((r) => r.role_id));
  let added = 0, removed = 0;
  for (const r of current) if (!seen.has(r)) { db.prepare('INSERT OR IGNORE INTO role_seen VALUES (?,?,?)').run(g, member.id, r); if (!init) { log(g, member.id, r, now, 'add', source); added++; } }
  for (const r of seen) if (!current.has(r)) { db.prepare('DELETE FROM role_seen WHERE guild_id=? AND user_id=? AND role_id=?').run(g, member.id, r); if (!init) { log(g, member.id, r, now, 'remove', source); removed++; } }
  return { added, removed };
}
/** サーバー全員を、同期する。初めてなら、「ここから記録」の目印を、付ける */
export function syncGuildRoles(guild, members) {
  const g = guild.id, first = trackingSince(g) == null, now = Date.now();
  db.exec('BEGIN');
  try { for (const m of members) if (!m.user?.bot) syncMemberRoles(g, m, { now, source: first ? 'init' : 'sync', init: first }); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  if (first) setKV(g, 'role_log_since', now);
}
export const forgetMember = (g, u) => db.prepare('DELETE FROM role_seen WHERE guild_id=? AND user_id=?').run(g, u); // 退出したら、再参加で付いたロールを、また、記録できるように

/** ユーザーが、そのロールを、はじめて取った時刻(ミリ秒)。分からなければ null */
export const roleObtainedAt = (g, u, role) => db.prepare("SELECT MIN(at) at FROM role_log WHERE guild_id=? AND user_id=? AND role_id=? AND action='add'").get(g, u, role)?.at ?? null;
/** 期間(日本時間の日付: 2026-11-01)を、ミリ秒に直す。since = その日の0時、until = その日の終わりまで(含む)。不正なら { error } */
export function parsePeriod(sinceStr, untilStr) {
  const one = (v, end) => { if (v == null || v === '') return null; const m = String(v).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); if (!m) return NaN; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600_000; return Number.isNaN(t) ? NaN : end ? t + 86400_000 : t; };
  const since = one(sinceStr, false), until = one(untilStr, true);
  if (Number.isNaN(since) || Number.isNaN(until)) return { error: '日付は、2026-11-01 の形で、書いてください(日本時間)' };
  if (since != null && until != null && since >= until) return { error: '開始日は、終了日より前にしてください' };
  return { since, until };
}
export const periodText = (p) => (p?.since != null || p?.until != null ? `期間: ${p.since != null ? new Date(p.since + 9 * 3600_000).toISOString().slice(0, 10) : '最初'} 〜 ${p.until != null ? new Date(p.until - 1 + 9 * 3600_000).toISOString().slice(0, 10) : '現在'}` : '');
const inPeriod = (at, p) => (p?.since == null || at >= p.since) && (p?.until == null || at < p.until);
/** そのロールを、はじめて取った時刻(ユーザーごと)。period を渡すと、「その期間に、取った」人だけ */
const firstAdds = (g, role, period = null) => new Map(db.prepare("SELECT user_id, MIN(at) at FROM role_log WHERE guild_id=? AND role_id=? AND action='add' GROUP BY user_id").all(g, role).filter((r) => inPeriod(r.at, period)).map((r) => [r.user_id, r.at]));

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
export function summarize(durations) {
  const d = [...durations].sort((a, b) => a - b);
  if (!d.length) return { n: 0 };
  const avg = d.reduce((a, b) => a + b, 0) / d.length, mid = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  return { n: d.length, avg, median: mid, p25: pct(d, 0.25), p75: pct(d, 0.75), min: d[0], max: d.at(-1) };
}
/** ロールA → ロールB の達成時間(Aを取ってから、Bを取るまで)。A・Bの両方を取った記録のある人だけ */
export function pairStats(g, fromRole, toRole, limit = 5, period = null) {
  const a = firstAdds(g, fromRole), b = firstAdds(g, toRole, period), dur = [], rows = []; // 期間は、「あとのロールを取った」時刻に、かける
  let bothBackwards = 0;
  for (const [u, at] of b) { const af = a.get(u); if (af == null) continue; if (at >= af) { dur.push(at - af); rows.push({ user_id: u, ms: at - af, from: af, to: at }); } else bothBackwards++; }
  return { ...summarize(dur), fromCount: a.size, toCount: b.size, backwards: bothBackwards, fastest: rows.sort((x, y) => x.ms - y.ms).slice(0, limit) };
}
/** そのロールを、サーバーに入ってから、いちばん早く取った人のランキング(参加 → ロール)。joinedOf(userId) = 参加した時刻(いるメンバーだけ) */
export function fastestSinceJoin(g, role, joinedOf, limit = 10, period = null) {
  const rows = [];
  for (const [u, at] of firstAdds(g, role, period)) { const j = joinedOf(u); if (j && at >= j) rows.push({ user_id: u, ms: at - j, from: j, to: at }); }
  return rows.sort((a, b) => a.ms - b.ms).slice(0, limit);
}
/** 参加(joinedTimestamp)から、そのロールを取るまで */
export function joinToStats(g, role, joinedOf, period = null) {
  const dur = []; for (const [u, at] of firstAdds(g, role, period)) { const j = joinedOf(u); if (j && at >= j) dur.push(at - j); }
  return summarize(dur);
}
export const dur = (ms) => { if (ms == null) return '—'; const s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}日${h}時間` : h ? `${h}時間${m}分` : m ? `${m}分` : `${s}秒`; };

/** 監査ログ(ロールの変更)から、取り込む。最大 maxEntries 件。権限(監査ログの表示)が必要 */
export async function importAudit(guild, { maxEntries = 1000, since = null, until = null } = {}) {
  const g = guild.id; let before, entries = 0, added = 0, stop = false;
  while (entries < maxEntries) {
    const page = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 100, ...(before ? { before } : {}) });
    if (!page.entries.size) break;
    for (const e of page.entries.values()) {
      if (since != null && e.createdTimestamp < since) { stop = true; continue; } // 新しい順に読んでいるので、期間より前に来たら、終わり
      if (until != null && e.createdTimestamp >= until) continue;
      entries++; const uid = e.targetId ?? e.target?.id; if (!uid) continue;
      for (const ch of e.changes ?? []) {
        const action = ch.key === '$add' ? 'add' : ch.key === '$remove' ? 'remove' : null; if (!action) continue;
        for (const r of ch.new ?? []) { const info = log(g, uid, r.id, e.createdTimestamp, action, 'audit'); added += Number(info.changes); }
      }
    }
    before = page.entries.last().id; if (stop || page.entries.size < 100) break;
  }
  return { entries, added };
}

/**
 * 過去の発言の時刻(backfill_times)から、「発言数」のルールの、ロールを取った時刻を、推定する。
 * 発言を、古い順に数えて(連投の間隔は、いまの設定どおり)、条件の数に届いた発言の時刻 = 取った時刻、とする。
 * いま、そのロールを持っている人だけ。source = 'estimate'(取った時刻は、実際に付いた時刻より、早いことがある)
 */
export async function estimateRoleTimes(guild) {
  const g = guild.id, rules = getRules(g).filter((r) => r.metric === 'messages').sort((a, b) => a.threshold - b.threshold);
  if (!rules.length) return { users: 0, added: 0 };
  const gap = getSettings(g).message_cooldown * 1000, has = (u, role) => !!guild.members.cache.get(u)?.roles?.cache?.has(role);
  let user = null, count = 0, last = -Infinity, idx = 0, users = 0, added = 0;
  const flush = () => { user = null; count = 0; last = -Infinity; idx = 0; };
  db.exec('BEGIN');
  try {
    for (const r of db.prepare('SELECT user_id, ts FROM backfill_times WHERE guild_id=? ORDER BY user_id, ts').iterate(g)) {
      if (r.user_id !== user) { flush(); user = r.user_id; users++; }
      if (gap && r.ts - last < gap) continue; // 連投は、数えない(いまの設定と、同じ)
      last = r.ts; count++;
      while (idx < rules.length && count >= rules[idx].threshold) { // この発言で、条件に届いた
        if (has(user, rules[idx].role_id)) { added += Number(log(g, user, rules[idx].role_id, r.ts, 'add', 'estimate').changes); }
        idx++;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { users, added };
}
export const sourceCounts = (g) => Object.fromEntries(db.prepare("SELECT source, COUNT(*) c FROM role_log WHERE guild_id=? AND action='add' GROUP BY source").all(g).map((r) => [r.source, r.c]));

/* ---------- 別のBOTなどが出した、ロール付与の通知から、取った時刻を、取り込む ---------- */
const textOf = (m) => [m.content, ...(m.embeds ?? []).flatMap((e) => [e.title, e.description, e.author?.name, e.footer?.text, ...(e.fields ?? []).flatMap((f) => [f.name, f.value])])].filter(Boolean).join('\n');
/** 通知の1通から、(だれが・どのロールを)を、読み取る。1人・1ロールに、決まったときだけ。{ userId, roleId } か null */
export function parseNotice(m, roles, { forceRole = null } = {}) {
  const text = textOf(m);
  const users = new Set([...text.matchAll(/<@!?(\d{15,25})>/g)].map((x) => x[1])); for (const id of m.mentions?.users?.keys?.() ?? []) users.add(id);
  if (users.size !== 1) return null; // 何人もの名前が出ている通知は、だれの分か、分からないので、読まない
  const userId = [...users][0];
  if (forceRole) return { userId, roleId: forceRole };
  const byMention = new Set([...text.matchAll(/<@&(\d{15,25})>/g)].map((x) => x[1])); for (const id of m.mentions?.roles?.keys?.() ?? []) byMention.add(id);
  const known = [...byMention].filter((id) => roles.has(id));
  if (known.length === 1) return { userId, roleId: known[0] };
  if (known.length > 1) return null;
  // ロール名が、文章に出ているか(長い名前を、先に。「常連」と「超常連」の、取り違えを防ぐ)
  const hits = [...roles.values()].filter((r) => r.name && r.name.length >= 2 && text.includes(r.name)).sort((a, b) => b.name.length - a.name.length);
  if (!hits.length) return null;
  const top = hits.filter((r) => r.name.length === hits[0].name.length);
  return top.length === 1 ? { userId, roleId: top[0].id } : null;
}
/**
 * チャンネルの過去の発言から、ロール付与の通知を、拾って、記録する(取った時刻 = 通知の時刻)。
 * authorId: その発言者(BOT)の通知だけ。省略すると、BOTの発言だけ。roleId: ロールを、決めて読む(通知に、ロール名が無いとき)。preview: 記録せず、読み取れた例だけ返す
 */
export async function importNotices(guild, channel, { authorId = null, roleId = null, preview = false, maxMessages = 10000, since = null, until = null } = {}) {
  const g = guild.id, roles = guild.roles.cache, found = [], samples = [], unread = [];
  let scanned = 0, before, stop = false;
  while (scanned < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const m of batch.values()) {
      if (since != null && m.createdTimestamp < since) { stop = true; continue; } // 期間より前: 新しい順に読んでいるので、ここから先は、読まない
      if (until != null && m.createdTimestamp >= until) continue;
      scanned++;
      if (authorId ? m.author?.id !== authorId : !m.author?.bot) continue;
      const r = parseNotice(m, roles, { forceRole: roleId });
      if (r) { found.push({ ...r, at: m.createdTimestamp }); if (samples.length < 5) samples.push({ userId: r.userId, roleName: roles.get(r.roleId)?.name ?? r.roleId, at: m.createdTimestamp, text: textOf(m).slice(0, 80) }); }
      else if (unread.length < 3 && textOf(m)) unread.push(textOf(m).slice(0, 80));
    }
    before = batch.last().id; if (stop || batch.size < 100) break;
  }
  let added = 0;
  if (!preview) { db.exec('BEGIN'); try { for (const e of found) added += Number(log(g, e.userId, e.roleId, e.at, 'add', 'notice').changes); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; } }
  return { scanned, matched: found.length, added, preview, samples, unread };
}
