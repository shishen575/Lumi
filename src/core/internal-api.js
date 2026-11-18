import express from 'express';
import crypto from 'node:crypto';
import { getRules, getStats, metricValue } from '../features/activity-roles/db.js';

/**
 * サイト → BOT の、サーバー間の内部API(ご当地めし帖との連携)。環境変数がそろったときだけ有効になる。
 *   INTERNAL_API_SECRET   署名用の共有シークレット(16文字以上)。ないときは、このAPIは無効
 *   INTERNAL_GUILD_ID     対象のサーバー(メンバー確認・ランク・ロール付与は、このサーバーだけ)
 *   INTERNAL_NOTIFY_CHANNEL_ID  新着お店の通知を出すチャンネル(宛先は、リクエストから指定させない)
 *   INTERNAL_GRANT_ROLE_ID      投稿数に応じて付与するロール(これも、固定)
 * 署名: X-Timestamp(ミリ秒。60秒より古い/先のものは拒否)と X-Signature = HMAC-SHA256(secret, `${timestamp}.${本文}`) の16進。
 * 同じ署名の再送は 409。
 */
const WINDOW_MS = 60_000;
const seen = new Map(); // 署名 → 期限(リプレイ対策)
const sweep = (now) => { for (const [k, t] of seen) if (t < now) seen.delete(k); };
const isId = (s) => /^\d{15,25}$/.test(String(s ?? ''));
const str = (v, n) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : undefined);

/** 受け取った embed を、安全な形に直す(長さ・個数の上限、https のリンクだけ) */
export function cleanEmbed(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const e = {};
  const title = str(raw.title, 256), desc = str(raw.description, 2000);
  if (title) e.title = title;
  if (desc) e.description = desc;
  if (typeof raw.url === 'string' && /^https:\/\//i.test(raw.url) && raw.url.length <= 2000) e.url = raw.url;
  const an = str(raw.author?.name, 256); if (an) e.author = { name: an };
  if (typeof raw.timestamp === 'string' && !Number.isNaN(Date.parse(raw.timestamp))) e.timestamp = new Date(raw.timestamp).toISOString();
  if (Array.isArray(raw.fields)) e.fields = raw.fields.slice(0, 25).map((f) => ({ name: str(f?.name, 256), value: str(f?.value, 1024), inline: !!f?.inline })).filter((f) => f.name && f.value);
  e.color = Number.isInteger(raw.color) && raw.color >= 0 && raw.color <= 0xffffff ? raw.color : 0xe67e22;
  return e.title || e.description ? e : null;
}

export function mountInternalApi(app, client) {
  const secret = (process.env.INTERNAL_API_SECRET || '').trim();
  if (secret.length < 16) return false; // 設定がなければ、道そのものを作らない
  const guildId = (process.env.INTERNAL_GUILD_ID || '').trim(), channelId = (process.env.INTERNAL_NOTIFY_CHANNEL_ID || '').trim(), roleId = (process.env.INTERNAL_GRANT_ROLE_ID || '').trim();
  const r = express.Router();
  r.use(express.raw({ type: () => true, limit: '64kb' }));

  r.use((req, res, next) => {
    const ts = String(req.get('x-timestamp') ?? ''), sig = String(req.get('x-signature') ?? ''), now = Date.now();
    if (!/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/i.test(sig) || Math.abs(now - Number(ts)) > WINDOW_MS) return res.status(401).json({ error: 'unauthorized' });
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const want = crypto.createHmac('sha256', secret).update(`${ts}.`).update(body).digest();
    const got = Buffer.from(sig, 'hex');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(401).json({ error: 'unauthorized' });
    sweep(now);
    const key = sig.toLowerCase();
    if (seen.has(key)) return res.status(409).json({ error: 'replay' });
    seen.set(key, now + WINDOW_MS * 2);
    req.rawText = body.toString('utf8');
    next();
  });
  const jsonBody = (req, res) => { try { return JSON.parse(req.rawText || '{}'); } catch { res.status(400).json({ error: 'bad json' }); return null; } };
  const guild = () => client.guilds.cache.get(guildId) ?? null;
  const memberOf = async (id) => { const g = guild(); if (!g || !isId(id)) return null; return g.members.fetch(id).catch(() => null); };

  // 1. 新着お店の通知
  r.post('/meshi-notify', async (req, res) => {
    const body = jsonBody(req, res); if (!body) return;
    const embed = cleanEmbed(body.embed); if (!embed) return res.status(400).json({ error: 'bad embed' });
    try {
      const ch = isId(channelId) ? await client.channels.fetch(channelId) : null;
      if (!ch?.isTextBased?.()) throw new Error('channel not available');
      await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
      res.json({ ok: true });
    } catch (e) { console.error('[internal] 通知に失敗:', e.message); res.status(502).json({ error: 'send failed' }); }
  });

  // 2. メンバー確認(ID・ロールID・参加日だけ)
  r.get('/members/:id', async (req, res) => {
    const m = await memberOf(req.params.id);
    if (!m) return res.status(404).json({ member: false });
    res.json({ member: true, roles: [...m.roles.cache.keys()].filter((x) => x !== m.guild.id), joinedAt: m.joinedAt?.toISOString() ?? null });
  });

  // 3. 活動ランク(発言数と、発言数のルールで到達している、いちばん高いロール)
  r.get('/users/:id/rank', async (req, res) => {
    if (!guild() || !isId(req.params.id)) return res.status(404).json({ error: 'not found' });
    const stats = getStats(guildId, req.params.id);
    if (!stats.messages && !stats.reactions_received && !stats.voice_seconds) return res.status(404).json({ error: 'not found' });
    const v = metricValue(stats, 'messages');
    const tier = getRules(guildId).filter((x) => x.metric === 'messages' && x.threshold <= v).sort((a, b) => b.threshold - a.threshold)[0];
    const role = tier ? guild().roles.cache.get(tier.role_id) : null;
    res.json({ messages: v, rankRole: role?.name ?? null, rankRoleId: tier?.role_id ?? null });
  });

  // 4. 投稿数に応じたロール付与(付けるロールは、設定で固定)
  r.post('/roles/grant', async (req, res) => {
    const body = jsonBody(req, res); if (!body) return;
    if (!isId(body.userId) || !isId(roleId)) return res.status(400).json({ error: 'bad request' });
    const m = await memberOf(body.userId); if (!m) return res.status(404).json({ error: 'member not found' });
    if (m.roles.cache.has(roleId)) return res.json({ ok: true, already: true });
    try { await m.roles.add(roleId, String(body.reason ?? 'ご当地めし帖').replace(/[\r\n]/g, ' ').slice(0, 100)); res.json({ ok: true }); }
    catch (e) { console.error('[internal] ロール付与に失敗:', e.message); res.status(502).json({ error: 'grant failed' }); }
  });

  app.use('/internal', r);
  console.log('[internal] 内部APIを有効にしました(/internal/*)');
  return true;
}
