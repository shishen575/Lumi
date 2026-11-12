import { db, migrate } from './db.js';

// 通信の速さの記録(1分ごと)。遅くなる時間帯や、REST とゲートウェイの違いを、あとから見るため。14日ぶんだけ残す
migrate(`CREATE TABLE IF NOT EXISTS latency_log (
  at INTEGER PRIMARY KEY, gateway INTEGER, rest INTEGER, stall INTEGER NOT NULL DEFAULT 0)`);

const KEEP_MS = 14 * 86400_000;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

export function recordLatency({ gateway, rest, stall = 0 }, at = Date.now()) {
  db.prepare('INSERT OR REPLACE INTO latency_log (at,gateway,rest,stall) VALUES (?,?,?,?)').run(at, num(gateway), num(rest), Math.round(stall) || 0);
}
export function pruneLatency(now = Date.now()) {
  return Number(db.prepare('DELETE FROM latency_log WHERE at < ?').run(now - KEEP_MS).changes);
}
/** 直近 hours 時間ぶん。長いときは、多くなりすぎないよう、間引く(最大 maxPoints 点) */
export function latencyRows(hours = 1, maxPoints = 720, now = Date.now()) {
  const rows = db.prepare('SELECT at,gateway,rest,stall FROM latency_log WHERE at >= ? ORDER BY at').all(now - hours * 3600_000);
  if (rows.length <= maxPoints) return rows;
  const step = rows.length / maxPoints, out = [];
  for (let i = 0; i < maxPoints; i++) {
    const seg = rows.slice(Math.floor(i * step), Math.floor((i + 1) * step));
    const max = (k) => seg.reduce((a, r) => (r[k] == null ? a : Math.max(a ?? 0, r[k])), null); // 遅い瞬間を見逃さないよう、最大値を残す
    out.push({ at: seg[0].at, gateway: max('gateway'), rest: max('rest'), stall: max('stall') ?? 0 });
  }
  return out;
}
export function latencySummary(hours = 1, now = Date.now()) {
  const r = db.prepare(`SELECT COUNT(*) n, AVG(gateway) gwAvg, MAX(gateway) gwMax, AVG(rest) restAvg, MAX(rest) restMax
    FROM latency_log WHERE at >= ?`).get(now - hours * 3600_000);
  return { n: Number(r.n), gwAvg: r.gwAvg == null ? null : Math.round(r.gwAvg), gwMax: r.gwMax, restAvg: r.restAvg == null ? null : Math.round(r.restAvg), restMax: r.restMax };
}
