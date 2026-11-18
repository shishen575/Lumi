import crypto from 'node:crypto';
import { db, migrate } from './db.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * 外のサイトとの連携。Lumi の `/integration create` で、1回だけ使える接続用トークンを出し、相手のサイトに貼ってもらう。
 * 相手は、そのトークンで `/internal/register` を呼び、「使いたい機能」(manifest)を送る。Lumi は、それを検査して、
 * ダッシュボードに、設定の画面を、自動で作る。管理者が、機能のオン・チャンネル・ロールを選んで、はじめて動く。
 * 相手が使えるのは、下の CAPS(許可リスト)の機能だけ。宛先のチャンネル・ロールは、いつも、管理者が決める。
 */
export const CAPS = {
  notify: { label: 'お知らせの投稿', help: '相手のサイトからの知らせを、決めたチャンネルに投稿します(メンションは飛ばしません)', field: { key: 'notifyChannel', type: 'channel', label: '投稿するチャンネル' } },
  members: { label: 'メンバー確認', help: 'サーバーのメンバーか・持っているロールID・参加日だけを、答えます', field: null },
  rank: { label: '活動ランクの取得', help: '発言数と、到達しているランクを、答えます', field: null },
  grant: { label: 'ロール付与', help: '決めたロールを、メンバーに付けます', field: { key: 'grantRole', type: 'role', label: '付与するロール' } },
};
const FIELD_TYPES = ['channel', 'role', 'toggle', 'text', 'number'];
export const PAIR_TTL_MS = 15 * 60_000;
export const MAX_PER_GUILD = 10;
export const MAX_SETTINGS = 16;

migrate(`CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, secret_enc TEXT, pair_hash TEXT, pair_exp INTEGER,
  manifest TEXT, config TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, last_seen INTEGER)`);

const clean = (v, n) => String(v ?? '').replace(/[\r\n<>@`*_~|]/g, '').trim().slice(0, n);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rowOut = (r) => r && { id: r.id, guildId: r.guild_id, name: r.name, status: r.status, manifest: r.manifest ? JSON.parse(r.manifest) : null, config: JSON.parse(r.config || '{}'), createdBy: r.created_by, createdAt: r.created_at, lastSeen: r.last_seen, pairExp: r.pair_exp };

/** 相手が送ってきた manifest を、安全な形に直す。許可リストにない機能は、捨てる */
export function cleanManifest(raw, ignored = { capabilities: [], settings: [] }) {
  if (!raw || typeof raw !== 'object') return null;
  const name = clean(raw.name, 30); if (!name) return null;
  const caps = [];
  for (const c of Array.isArray(raw.capabilities) ? raw.capabilities : []) { if (typeof c === 'string' && c in CAPS) { if (!caps.includes(c)) caps.push(c); } else ignored.capabilities.push(String(c).slice(0, 40)); }
  const used = new Set(Object.values(CAPS).map((c) => c.field?.key).filter(Boolean)), settings = [];
  (Array.isArray(raw.settings) ? raw.settings : []).forEach((f, n) => {
    const key = String(f?.key ?? ''), skip = (why) => ignored.settings.push({ key: key.slice(0, 40), reason: why });
    if (n >= MAX_SETTINGS) return skip(`${MAX_SETTINGS + 1}件目以降は、受け付けません(最大${MAX_SETTINGS}件)`);
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(key)) return skip('key は、英小文字で始まる、英小文字・数字・_ の24文字まで');
    if (used.has(key)) return skip('key が重複しています(予約済みの key も含みます)');
    if (!FIELD_TYPES.includes(f?.type)) return skip(`type は ${FIELD_TYPES.join(' / ')} のどれか`);
    used.add(key); settings.push({ key, type: f.type, label: clean(f.label, 30) || key, help: clean(f.help, 100) });
  });
  return { name, description: clean(raw.description, 200), capabilities: caps, settings };
}

/** 接続用トークンを作る(管理者のコマンドから)。トークンは、この1回しか見えない */
export function createPairing(guildId, name, userId, now = Date.now()) {
  db.prepare("DELETE FROM integrations WHERE guild_id=? AND status='waiting' AND pair_exp<?").run(guildId, now); // 期限切れの、接続待ちは、消す(数に数えない)
  if (db.prepare("SELECT COUNT(*) c FROM integrations WHERE guild_id=? AND status!='revoked'").get(guildId).c >= MAX_PER_GUILD) return { error: `連携は、1サーバーで最大${MAX_PER_GUILD}件までです。使わないものは、削除してください。` };
  const id = `int_${crypto.randomBytes(6).toString('hex')}`, token = `lumi_${crypto.randomBytes(24).toString('base64url')}`;
  db.prepare("INSERT INTO integrations (id, guild_id, name, pair_hash, pair_exp, status, created_by, created_at) VALUES (?,?,?,?,?,'waiting',?,?)").run(id, guildId, clean(name, 30) || '連携', sha(token), now + PAIR_TTL_MS, userId, now);
  return { id, token, expiresAt: now + PAIR_TTL_MS };
}

/** 相手が、トークンと manifest を送ってきた。成功したら、永続の署名シークレットを、この1回だけ返す */
export function redeemPairing(token, manifestRaw, now = Date.now()) {
  const r = db.prepare("SELECT * FROM integrations WHERE pair_hash=?").get(sha(String(token ?? '').trim()));
  if (!r) return { error: 'invalid_token', status: 401, why: 'トークンが、見つかりません' };
  if (r.status !== 'waiting') return { error: 'token_used', status: 401, why: `使用済みです(${r.id})` };
  if (r.pair_exp < now) return { error: 'token_expired', status: 401, why: `期限切れです(${r.id}、${Math.round((now - r.pair_exp) / 1000)}秒前)` };
  const ignored = { capabilities: [], settings: [] }, manifest = cleanManifest(manifestRaw, ignored);
  if (!manifest) return { error: 'bad_manifest', status: 400, why: `manifest が不正です(${r.id}。name が必要)` }; // 検証に失敗しても、トークンは、使い切らない
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("UPDATE integrations SET status='active', secret_enc=?, manifest=?, name=?, config=? WHERE id=?")
    .run(encrypt(secret), JSON.stringify(manifest), manifest.name, JSON.stringify({ enabled: {}, values: {} }), r.id);
  return { id: r.id, guildId: r.guild_id, secret, manifest, ignored };
}

export const getIntegration = (id) => rowOut(db.prepare("SELECT * FROM integrations WHERE id=? AND status!='revoked'").get(String(id)));
export const secretOf = (id) => { const r = db.prepare("SELECT secret_enc FROM integrations WHERE id=? AND status='active'").get(String(id)); return r?.secret_enc ? decrypt(r.secret_enc) : null; };
export const listIntegrations = (guildId) => db.prepare("SELECT * FROM integrations WHERE guild_id=? AND status!='revoked' ORDER BY created_at DESC").all(guildId).map(rowOut);
export const touch = (id, now = Date.now()) => db.prepare('UPDATE integrations SET last_seen=? WHERE id=?').run(now, id);
export const revoke = (guildId, id) => db.prepare("UPDATE integrations SET status='revoked', secret_enc=NULL, pair_hash=NULL WHERE id=? AND guild_id=?").run(id, guildId).changes > 0;

/** 管理者が決めた設定を、保存する。manifest にある項目だけ。チャンネル・ロールの、実在の確認は、呼ぶ側で */
export function saveConfig(guildId, id, input) {
  const it = rowOut(db.prepare("SELECT * FROM integrations WHERE id=? AND guild_id=? AND status='active'").get(id, guildId)); if (!it) return null;
  const enabled = {}, values = {};
  for (const c of it.manifest.capabilities) enabled[c] = !!input?.enabled?.[c];
  const fields = [...it.manifest.capabilities.map((c) => CAPS[c].field).filter(Boolean), ...it.manifest.settings];
  for (const f of fields) {
    const v = input?.values?.[f.key];
    if (f.type === 'toggle') values[f.key] = !!v;
    else if (f.type === 'number') values[f.key] = Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null;
    else if (f.type === 'text') values[f.key] = clean(v, 200);
    else values[f.key] = /^\d{15,25}$/.test(String(v ?? '')) ? String(v) : '';
  }
  db.prepare('UPDATE integrations SET config=? WHERE id=?').run(JSON.stringify({ enabled, values }), id);
  return { ...it, config: { enabled, values } };
}
