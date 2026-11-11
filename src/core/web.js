import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKV, setKV, db } from './db.js';
import { mountGithubWebhook } from './webhook.js';

const API = 'https://discord.com/api/v10';
const PERM_ADMIN = 0x8n, PERM_MANAGE_GUILD = 0x20n;

export function startWeb(client, features) {
  const app = express();
  const BASE = process.env.BASE_URL || 'http://localhost:3000';
  app.set('trust proxy', 1); // Cloudflare Tunnel / リバプロ越し
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } })); // Webhook署名検証用に生ボディを保持
  mountGithubWebhook(app);
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: BASE.startsWith('https'), maxAge: 7 * 864e5 },
  }));
  app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public')));

  // ---------- OAuth2 ----------
  app.get('/auth/login', (req, res) => {
    req.session.state = crypto.randomBytes(16).toString('hex');
    res.redirect(`https://discord.com/oauth2/authorize?${new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify guilds',
      redirect_uri: `${BASE}/auth/callback`, state: req.session.state })}`);
  });
  app.get('/auth/callback', async (req, res) => {
    try {
      if (!req.query.code || req.query.state !== req.session.state) return res.status(400).send('invalid state');
      const tok = await fetch(`${API}/oauth2/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code', code: req.query.code, redirect_uri: `${BASE}/auth/callback` }),
      }).then((r) => r.json());
      if (!tok.access_token) return res.status(400).send('token error');
      const h = { Authorization: `Bearer ${tok.access_token}` };
      const [user, guilds] = await Promise.all([
        fetch(`${API}/users/@me`, { headers: h }).then((r) => r.json()),
        fetch(`${API}/users/@me/guilds`, { headers: h }).then((r) => r.json()),
      ]);
      // 管理権限のあるサーバーだけ保持(アクセストークンは保存しない)
      req.session.user = { id: user.id, name: user.global_name || user.username };
      req.session.guilds = guilds
        .filter((g) => g.owner || (BigInt(g.permissions) & (PERM_ADMIN | PERM_MANAGE_GUILD)) !== 0n)
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
      res.redirect('/');
    } catch (e) { console.error(e); res.status(500).send('login failed'); }
  });
  app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

  // ---------- API ----------
  const api = express.Router();
  api.use((req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'login required' })));

  api.get('/me', (req, res) => res.json({ user: req.session.user }));
  api.get('/features', (req, res) => res.json(features.map((f) => ({ name: f.name, title: f.title, ui: f.ui }))));
  api.get('/guilds', (req, res) => res.json({
    guilds: req.session.guilds.map((g) => ({ ...g, botIn: client.guilds.cache.has(g.id) })),
    invite: `https://discord.com/oauth2/authorize?${new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID, scope: 'bot', permissions: '268435456' })}`, // Manage Roles
  }));

  // /api/guilds/:gid/... は管理権限チェック済み。req.guild が使える
  const guildApi = express.Router({ mergeParams: true });
  guildApi.use((req, res, next) => {
    if (!req.session.guilds?.some((g) => g.id === req.params.gid)) return res.status(403).json({ error: 'forbidden' });
    const guild = client.guilds.cache.get(req.params.gid);
    if (!guild) return res.status(404).json({ error: 'bot is not in this server' });
    req.guild = guild; next();
  });
  guildApi.get('/roles', (req, res) => {
    const me = req.guild.members.me;
    res.json(req.guild.roles.cache
      .filter((r) => r.id !== req.guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, assignable: r.position < me.roles.highest.position })));
  });
  guildApi.get('/channels', (req, res) => res.json(
    req.guild.channels.cache.filter((c) => c.isTextBased() && !c.isThread())
      .map((c) => ({ id: c.id, name: c.name, type: c.type })).sort((a, b) => a.name.localeCompare(b.name))));

  // 各機能は /api/guilds/:gid/f/<name>/ に自分のRouterを持つ
  for (const f of features) {
    const router = express.Router({ mergeParams: true });
    f.register({ client, router, db, getKV, setKV });
    guildApi.use(`/f/${f.name}`, router);
    console.log(`[feature] ${f.name} loaded`);
  }
  api.use('/guilds/:gid', guildApi);
  app.use('/api', api);

  const port = Number(process.env.PORT || process.env.SERVER_PORT) || 3000;
  app.listen(port, () => console.log(`Dashboard: ${BASE} (port ${port})`));
}
