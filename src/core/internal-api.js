import express from 'express';
import crypto from 'node:crypto';
import { getRules, getStats, metricValue } from '../features/activity-roles/db.js';
import { getIntegration, secretOf, redeemPairing, touch } from './integrations.js';

/**
 * サイト → BOT の、サーバー間の内部API(ご当地めし帖との連携)。環境変数がそろったときだけ有効になる。
 *   INTERNAL_API_SECRET   署名用の共有シークレット(16文字以上)。ないときは、このAPIは無効
 *   INTERNAL_GUILD_ID     対象のサーバー(メンバー確認・ランク・ロール付与は、このサーバーだけ)
 *   INTERNAL_NOTIFY_CHANNEL_ID  新着お店の通知を出すチャンネル(宛先は、リクエストから指定させない)
 *   INTERNAL_GRANT_ROLE_ID      投稿数に応じて付与するロール(これも、固定)
 * 連携は、`/integration create` のトークンで、相手が `POST /internal/register` を呼んで作る(ダッシュボードに設定画面ができる)。
 *   相手は、署名に、X-Integration-Id(register の返事の id)をつける。上の環境変数は、それを使わない「固定の1件」用(省略できる)
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
  const envSecret = (process.env.INTERNAL_API_SECRET || '').trim(), legacy = envSecret.length >= 16;
  const legacyCfg = { guildId: (process.env.INTERNAL_GUILD_ID || '').trim(), channelId: (process.env.INTERNAL_NOTIFY_CHANNEL_ID || '').trim(), roleId: (process.env.INTERNAL_GRANT_ROLE_ID || '').trim() };
  const r = express.Router();
  r.use(express.raw({ type: () => true, limit: '64kb' }));
  const tries = new Map(); // 接続用トークンの総当たり対策(IPごとに、1分に10回まで)
  const jsonOf = (req, res) => { try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') || '{}' : '{}'); } catch { res.status(400).json({ error: 'bad json' }); return null; } };

  // 接続: トークンと manifest(使いたい機能)を送ると、署名用のシークレットが、1回だけ返る
  r.post('/register', (req, res) => {
    const now = Date.now(), ip = req.ip, t = tries.get(ip) ?? { n: 0, until: now + 60_000 };
    if (t.until < now) { t.n = 0; t.until = now + 60_000; }
    if (++t.n > 10) return res.status(429).json({ error: 'too many requests' });
    tries.set(ip, t); if (tries.size > 500) for (const [k, v] of tries) if (v.until < now) tries.delete(k);
    const body = jsonOf(req, res); if (!body) return;
    const out = redeemPairing(body.token, body.manifest, now);
    if (out.error) { console.warn(`[internal] 登録を拒否: ${out.error} — ${out.why}`); return res.status(out.status).json({ error: out.error }); }
    if (out.ignored.capabilities.length || out.ignored.settings.length) console.warn(`[internal] manifest で、無視した項目 (${out.id}):`, JSON.stringify(out.ignored));
    const base = (process.env.BASE_URL || '').replace(/\/+$/, '');
    console.log(`[internal] 連携を登録しました: ${out.manifest.name} (${out.id}, サーバー ${out.guildId})`);
    res.json({ ok: true, integrationId: out.id, secret: out.secret, capabilities: out.manifest.capabilities, settings: out.manifest.settings.map((f) => f.key), ignored: out.ignored, note: '管理者が、ダッシュボードで、機能をオンにするまで、各APIは使えません(403)。署名には、X-Integration-Id を付けてください。', endpoints: { settings: 'GET /internal/settings', notify: 'POST /internal/meshi-notify', member: 'GET /internal/members/:id', rank: 'GET /internal/users/:id/rank', grant: 'POST /internal/roles/grant' }, base });
  });

  // ここから下は、署名つき。連携(X-Integration-Id)か、環境変数の固定の1件
  r.use((req, res, next) => {
    const ts = String(req.get('x-timestamp') ?? ''), sig = String(req.get('x-signature') ?? ''), iid = String(req.get('x-integration-id') ?? ''), now = Date.now();
    const no = (why) => { console.warn(`[internal] 署名つきの呼び出しを拒否: ${why} (${req.method} ${req.path}${iid ? ', ' + iid : ''})`); return res.status(401).json({ error: 'unauthorized' }); }; // 相手には、理由を教えない。ログにだけ残す
    if (!/^\d{10,16}$/.test(ts)) return no('X-Timestamp が、ありません・数字ではありません(ミリ秒の数字)');
    if (!/^[0-9a-f]{64}$/i.test(sig)) return no('X-Signature が、ありません・64桁の16進ではありません');
    if (Math.abs(now - Number(ts)) > WINDOW_MS) return no(`X-Timestamp が、ずれています(${Math.round((now - Number(ts)) / 1000)}秒。秒ではなくミリ秒で送ってください)`);
    let ctx;
    if (iid) { const it = getIntegration(iid), sec = it?.status === 'active' ? secretOf(iid) : null; if (!sec) return no(it ? '連携が有効ではありません(接続待ち)' : '連携IDが、ありません・削除済みです'); ctx = { secret: sec, it, guildId: it.guildId, channelId: it.config.values?.notifyChannel ?? '', roleId: it.config.values?.grantRole ?? '', can: (c) => !!it.config.enabled?.[c] && it.manifest.capabilities.includes(c) }; }
    else if (legacy) ctx = { secret: envSecret, it: null, ...legacyCfg, can: () => true };
    else return no('X-Integration-Id が、ありません(環境変数の固定の連携も、設定されていません)');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const want = crypto.createHmac('sha256', ctx.secret).update(`${ts}.`).update(body).digest(), got = Buffer.from(sig, 'hex');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return no('署名が、一致しません(secret・`timestamp.本文` の組み立て・本文のバイト列を確認)');
    sweep(now);
    const key = `${iid}:${sig.toLowerCase()}`;
    if (seen.has(key)) { console.warn(`[internal] 再送を拒否 (${iid || '固定'}, ${req.path})`); return res.status(409).json({ error: 'replay' }); }
    seen.set(key, now + WINDOW_MS * 2);
    req.rawText = body.toString('utf8'); req.ctx = ctx;
    if (ctx.it) touch(ctx.it.id, now);
    next();
  });
  const need = (cap) => (req, res, next) => (req.ctx.can(cap) ? next() : res.status(403).json({ error: 'not enabled', detail: 'このサーバーの管理者が、ダッシュボードで、この機能をオンにしていません' }));
  const jsonBody = (req, res) => { try { return JSON.parse(req.rawText || '{}'); } catch { res.status(400).json({ error: 'bad json' }); return null; } };
  const guildOf = (req) => client.guilds.cache.get(req.ctx.guildId) ?? null;
  const memberOf = async (req, id) => { const g = guildOf(req); if (!g || !isId(id)) return null; return g.members.fetch(id).catch(() => null); };

  // 管理者が決めた、設定の値(manifest の settings の項目だけ。チャンネル・ロールのIDは、返さない)
  r.get('/settings', (req, res) => {
    const it = req.ctx.it; if (!it) return res.json({ values: {} });
    const keys = new Set(it.manifest.settings.map((f) => f.key)), values = {};
    for (const [k, v] of Object.entries(it.config.values ?? {})) if (keys.has(k)) values[k] = v;
    res.json({ enabled: it.config.enabled, values });
  });

  // 1. 新着お店の通知
  r.post('/meshi-notify', need('notify'), async (req, res) => {
    const body = jsonBody(req, res); if (!body) return;
    const embed = cleanEmbed(body.embed); if (!embed) return res.status(400).json({ error: 'bad embed' });
    if (!isId(req.ctx.channelId)) return res.status(403).json({ error: 'not configured', detail: '投稿するチャンネルが、まだ決まっていません' });
    try {
      const ch = isId(req.ctx.channelId) ? await client.channels.fetch(req.ctx.channelId) : null;
      if (!ch?.isTextBased?.() || ch.guildId !== req.ctx.guildId) throw new Error('channel not available');
      await ch.send({ embeds: [embed], allowedMentions: { parse: [] } });
      res.json({ ok: true });
    } catch (e) { console.error('[internal] 通知に失敗:', e.message); res.status(502).json({ error: 'send failed' }); }
  });

  // 2. メンバー確認(ID・ロールID・参加日だけ)
  r.get('/members/:id', need('members'), async (req, res) => {
    const m = await memberOf(req, req.params.id);
    if (!m) return res.status(404).json({ member: false });
    res.json({ member: true, roles: [...m.roles.cache.keys()].filter((x) => x !== m.guild.id), joinedAt: m.joinedAt?.toISOString() ?? null });
  });

  // 3. 活動ランク(発言数と、発言数のルールで到達している、いちばん高いロール)
  r.get('/users/:id/rank', need('rank'), async (req, res) => {
    const g = guildOf(req); if (!g || !isId(req.params.id)) return res.status(404).json({ error: 'not found' });
    const stats = getStats(g.id, req.params.id);
    if (!stats.messages && !stats.reactions_received && !stats.voice_seconds) return res.status(404).json({ error: 'not found' });
    const v = metricValue(stats, 'messages');
    const tier = getRules(g.id).filter((x) => x.metric === 'messages' && x.threshold <= v).sort((a, b) => b.threshold - a.threshold)[0];
    res.json({ messages: v, rankRole: (tier && g.roles.cache.get(tier.role_id)?.name) ?? null, rankRoleId: tier?.role_id ?? null });
  });

  // 4. ロール付与(付けるロールは、管理者が、固定)
  r.post('/roles/grant', need('grant'), async (req, res) => {
    const body = jsonBody(req, res); if (!body) return;
    if (!isId(req.ctx.roleId)) return res.status(403).json({ error: 'not configured', detail: '付与するロールが、まだ決まっていません' });
    if (!isId(body.userId)) return res.status(400).json({ error: 'bad request' });
    const m = await memberOf(req, body.userId); if (!m) return res.status(404).json({ error: 'member not found' });
    if (m.roles.cache.has(req.ctx.roleId)) return res.json({ ok: true, already: true });
    try { await m.roles.add(req.ctx.roleId, String(body.reason ?? '連携').replace(/[\r\n]/g, ' ').slice(0, 100)); res.json({ ok: true }); }
    catch (e) { console.error('[internal] ロール付与に失敗:', e.message); res.status(502).json({ error: 'grant failed' }); }
  });

  app.use('/internal', r);
  console.log(`[internal] 内部APIを有効にしました(/internal/*${legacy ? '・環境変数の固定の連携あり' : ''})`);
  return true;
}
