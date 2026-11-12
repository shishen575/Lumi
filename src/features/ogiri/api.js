import { canEditAccess } from '../../core/access.js';
import { getTts, setToken, clearToken, setToggles, markInvalid, health, session, TtsError } from './tts.js';
import { decrypt } from '../../core/crypto.js';

/** 読み上げ連携のダッシュボードAPI。router は /api/guilds/:gid/f/ogiri に載っていて、req.guild / req.access が使える */
export function mountApi(router) {
  const view = (req) => {
    const t = getTts(req.guild.id);
    return { connected: !!t.tokenEnc && !t.invalid, tokenSet: !!t.tokenEnc, invalid: !!t.invalid, guildName: t.guildName, toggles: t.toggles,
      canEditToken: canEditAccess(req.access) }; // トークン自体は、返さない
  };
  const readError = (e) => (e instanceof TtsError
    ? { status: 400, error: e.status === 401 ? 'トークンが正しくありません。読み上げBOTの /external で、発行し直してください' : `読み上げBOTがエラーを返しました (${e.status})` }
    : { status: 502, error: '読み上げBOTに接続できませんでした。時間をおいて、もう一度お試しください' });

  router.get('/tts', (req, res) => res.json(view(req)));

  // トークンの登録: 読み上げBOTで確認して、このサーバーのトークンであることを確かめてから、暗号化して保存する
  router.put('/tts/token', async (req, res) => {
    if (!canEditAccess(req.access)) return res.status(403).json({ error: 'トークンを登録できるのは、サーバーのオーナー・管理者・運営だけです' });
    const token = String(req.body?.token ?? '').trim();
    if (!/^shb2_[A-Za-z0-9_-]{20,200}$/.test(token)) return res.status(400).json({ error: 'トークンの形式が違います(shb2_ で始まる文字列です)' });
    try {
      const h = await health(token);
      if (String(h.guild_id) !== req.guild.id) return res.status(400).json({ error: `このトークンは、別のサーバー(${h.guild_name ?? h.guild_id})のものです` });
      setToken(req.guild.id, token, h.guild_name ?? req.guild.name);
      res.json(view(req));
    } catch (e) { const r = readError(e); res.status(r.status).json({ error: r.error }); }
  });
  router.delete('/tts/token', (req, res) => {
    if (!canEditAccess(req.access)) return res.status(403).json({ error: '連携を解除できるのは、サーバーのオーナー・管理者・運営だけです' });
    clearToken(req.guild.id); res.json(view(req));
  });

  router.put('/tts/toggles', (req, res) => {
    const b = req.body ?? {};
    setToggles(req.guild.id, { odai: !!b.odai, answer: !!b.answer, sayName: !!b.sayName, result: !!b.result });
    res.json(view(req));
  });

  // 接続テスト
  router.post('/tts/test', async (req, res) => {
    const t = getTts(req.guild.id); const token = t.tokenEnc && decrypt(t.tokenEnc);
    if (!token) return res.status(400).json({ error: '連携されていません' });
    try { const h = await health(token); if (t.invalid) setToken(req.guild.id, token, h.guild_name); res.json({ ok: true, guild_name: h.guild_name }); }
    catch (e) { if (e instanceof TtsError && e.status === 401) markInvalid(req.guild.id); const r = readError(e); res.status(r.status).json({ error: r.error }); }
  });

  // そのチャンネルが、いま読み上げ中か
  router.get('/tts/session', async (req, res) => {
    try { res.json((await session(req.guild.id, String(req.query.channel_id ?? ''))) ?? { active: false }); }
    catch (e) { const r = readError(e); res.status(r.status).json({ error: r.error }); }
  });
}
