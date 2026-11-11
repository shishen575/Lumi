import { db } from '../../core/db.js';
import { METRICS, getRules, getSettings, saveSettings, leaderboard, metricValue } from './db.js';
import { evaluateGuild } from './roles.js';
import { sendTest } from './notify.js';
import { startBackfill, resumeBackfill, getJob } from './backfill.js';

/** router は /api/guilds/:gid/f/activity-roles に載っていて、req.guild が使える */
export function mountApi(router) {
  router.get('/meta', (req, res) => res.json({ metrics: METRICS, botJoinedAt: req.guild.members.me?.joinedTimestamp ?? null }));
  router.get('/rules', (req, res) => res.json(getRules(req.guild.id)));

  const parseRule = (b) => {
    const threshold = Number.parseInt(b.threshold, 10);
    if (!(b.metric in METRICS)) return { error: '不正な条件です' };
    if (!Number.isFinite(threshold) || threshold < 1 || threshold > 1e9) return { error: '回数/時間は1以上の整数にしてください' };
    return { metric: b.metric, threshold, role_id: String(b.role_id), replace_lower: b.replace_lower ? 1 : 0 };
  };
  const roleOk = (req, id) => {
    const r = req.guild.roles.cache.get(id);
    return r && r.id !== req.guild.id && !r.managed && req.canAssign(r); // 自分より上のロールは不可
  };

  router.post('/rules', (req, res) => {
    const r = parseRule(req.body);
    if (r.error) return res.status(400).json(r);
    if (!roleOk(req, r.role_id)) return res.status(400).json({ error: 'このロールは設定できません(自分の最上位ロールより下のロールだけ選べます)' });
    if (getRules(req.guild.id).length >= 100) return res.status(400).json({ error: 'ルール数の上限(100)です' });
    const info = db.prepare('INSERT INTO rules (guild_id,metric,threshold,role_id,replace_lower) VALUES (?,?,?,?,?)')
      .run(req.guild.id, r.metric, r.threshold, r.role_id, r.replace_lower);
    res.json({ id: Number(info.lastInsertRowid), ...r });
  });
  router.put('/rules/:rid', (req, res) => {
    const r = parseRule(req.body);
    if (r.error) return res.status(400).json(r);
    if (!roleOk(req, r.role_id)) return res.status(400).json({ error: 'このロールは設定できません(自分の最上位ロールより下のロールだけ選べます)' });
    const info = db.prepare('UPDATE rules SET metric=?,threshold=?,role_id=?,replace_lower=? WHERE id=? AND guild_id=?')
      .run(r.metric, r.threshold, r.role_id, r.replace_lower, req.params.rid, req.guild.id);
    res.json({ ok: info.changes > 0 });
  });
  router.delete('/rules/:rid', (req, res) => {
    db.prepare('DELETE FROM rules WHERE id=? AND guild_id=?').run(req.params.rid, req.guild.id);
    res.json({ ok: true });
  });

  router.get('/settings', (req, res) => res.json(getSettings(req.guild.id)));
  router.put('/settings', (req, res) => {
    const cd = Math.min(3600, Math.max(0, Number.parseInt(req.body.message_cooldown, 10) || 0));
    const chId = req.body.notify_channel_id ? String(req.body.notify_channel_id) : null;
    if (chId) {
      const ch = req.guild.channels.cache.get(chId);
      if (!ch?.isTextBased() || ch.isThread()) return res.status(400).json({ error: '通知チャンネルが不正です' });
    }
    const tpl = String(req.body.notify_template ?? '').trim().slice(0, 500) || null;
    saveSettings(req.guild.id, { message_cooldown: cd, voice_require_others: req.body.voice_require_others ? 1 : 0,
      notify_channel_id: chId, notify_template: tpl });
    res.json({ ok: true });
  });
  router.post('/notify-test', async (req, res) => {
    try {
      const ok = await sendTest(req.guild, req.member);
      res.status(ok ? 200 : 400).json(ok ? { ok: true } : { error: '通知チャンネルが未設定、または送信できません(保存してから試してください)' });
    } catch (e) { res.status(400).json({ error: '送信に失敗: ' + e.message }); }
  });

  router.get('/leaderboard', async (req, res) => {
    const metric = req.query.metric in METRICS ? req.query.metric : 'messages';
    const rows = leaderboard(req.guild.id, metric);
    res.json(await Promise.all(rows.map(async (s) => {
      const m = req.guild.members.cache.get(s.user_id) ?? (await req.guild.members.fetch(s.user_id).catch(() => null));
      return { user_id: s.user_id, name: m?.displayName ?? s.user_id, value: metricValue(s, metric) };
    })));
  });

  // 過去の発言数の取り込み(上書き)
  router.get('/backfill', (req, res) => res.json(getJob(req.guild.id) ?? null));
  router.post('/backfill', (req, res) => {
    const num = (v) => (v == null || v === '' ? null : Number(v));
    const from = num(req.body.from), to = num(req.body.to);
    if ([from, to].some((v) => v != null && !Number.isFinite(v))) return res.status(400).json({ error: '期間が不正です' });
    if (from != null && to != null && from >= to) return res.status(400).json({ error: '開始日は終了日より前にしてください' });
    if (!startBackfill(req.guild, { from, to })) return res.status(409).json({ error: '取り込み中です' });
    res.json({ ok: true });
  });

  router.post('/backfill/resume', (req, res) => {
    if (!resumeBackfill(req.guild)) return res.status(409).json({ error: '再開できる取り込みがありません' });
    res.json({ ok: true });
  });

  router.post('/sync', async (req, res) => {
    try { res.json({ changed: await evaluateGuild(req.guild) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
}
