import { AuditLogEvent } from 'discord.js';
import { db, migrate, getKV, setKV } from '../../core/db.js';

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
const firstAdds = (g, role) => new Map(db.prepare("SELECT user_id, MIN(at) at FROM role_log WHERE guild_id=? AND role_id=? AND action='add' GROUP BY user_id").all(g, role).map((r) => [r.user_id, r.at]));

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
export function summarize(durations) {
  const d = [...durations].sort((a, b) => a - b);
  if (!d.length) return { n: 0 };
  const avg = d.reduce((a, b) => a + b, 0) / d.length, mid = d.length % 2 ? d[(d.length - 1) / 2] : (d[d.length / 2 - 1] + d[d.length / 2]) / 2;
  return { n: d.length, avg, median: mid, p25: pct(d, 0.25), p75: pct(d, 0.75), min: d[0], max: d.at(-1) };
}
/** ロールA → ロールB の達成時間(Aを取ってから、Bを取るまで)。A・Bの両方を取った記録のある人だけ */
export function pairStats(g, fromRole, toRole, limit = 5) {
  const a = firstAdds(g, fromRole), b = firstAdds(g, toRole), dur = [], rows = [];
  let bothBackwards = 0;
  for (const [u, at] of b) { const af = a.get(u); if (af == null) continue; if (at >= af) { dur.push(at - af); rows.push({ user_id: u, ms: at - af, from: af, to: at }); } else bothBackwards++; }
  return { ...summarize(dur), fromCount: a.size, toCount: b.size, backwards: bothBackwards, fastest: rows.sort((x, y) => x.ms - y.ms).slice(0, limit) };
}
/** そのロールを、サーバーに入ってから、いちばん早く取った人のランキング(参加 → ロール)。joinedOf(userId) = 参加した時刻(いるメンバーだけ) */
export function fastestSinceJoin(g, role, joinedOf, limit = 10) {
  const rows = [];
  for (const [u, at] of firstAdds(g, role)) { const j = joinedOf(u); if (j && at >= j) rows.push({ user_id: u, ms: at - j, from: j, to: at }); }
  return rows.sort((a, b) => a.ms - b.ms).slice(0, limit);
}
/** 参加(joinedTimestamp)から、そのロールを取るまで */
export function joinToStats(g, role, joinedOf) {
  const dur = []; for (const [u, at] of firstAdds(g, role)) { const j = joinedOf(u); if (j && at >= j) dur.push(at - j); }
  return summarize(dur);
}
export const dur = (ms) => { if (ms == null) return '—'; const s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}日${h}時間` : h ? `${h}時間${m}分` : m ? `${m}分` : `${s}秒`; };

/** 監査ログ(ロールの変更)から、取り込む。最大 maxEntries 件。権限(監査ログの表示)が必要 */
export async function importAudit(guild, { maxEntries = 1000 } = {}) {
  const g = guild.id; let before, entries = 0, added = 0;
  while (entries < maxEntries) {
    const page = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 100, ...(before ? { before } : {}) });
    if (!page.entries.size) break;
    for (const e of page.entries.values()) {
      entries++; const uid = e.targetId ?? e.target?.id; if (!uid) continue;
      for (const ch of e.changes ?? []) {
        const action = ch.key === '$add' ? 'add' : ch.key === '$remove' ? 'remove' : null; if (!action) continue;
        for (const r of ch.new ?? []) { const info = log(g, uid, r.id, e.createdTimestamp, action, 'audit'); added += Number(info.changes); }
      }
    }
    before = page.entries.last().id; if (page.entries.size < 100) break;
  }
  return { entries, added };
}
