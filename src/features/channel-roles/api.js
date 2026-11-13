import { ChannelType } from 'discord.js';
import { getRules, addRule, updateRule, deleteRule } from './db.js';

/** router は /api/guilds/:gid/f/channel-roles に載っていて、req.guild / req.canAssign が使える */
export function mountApi(router) {
  const parse = (req) => {
    const b = req.body ?? {}, min = Number.parseInt(b.min_messages, 10);
    const ch = req.guild.channels.cache.get(String(b.channel_id));
    const isCat = ch?.type === ChannelType.GuildCategory;
    if (!ch || (!isCat && (!ch.isTextBased() || ch.isThread()))) return { error: 'チャンネル(またはカテゴリ)が不正です' };
    if (!Number.isFinite(min) || min < 1 || min > 100000) return { error: '発言数は、1以上の整数にしてください' };
    const role = req.guild.roles.cache.get(String(b.role_id));
    if (!role || role.id === req.guild.id || role.managed || !req.canAssign(role)) return { error: 'このロールは設定できません(自分の最上位ロールより下のロールだけ選べます)' };
    return { channel_id: ch.id, kind: isCat ? 'category' : 'channel', role_id: role.id, min_messages: min, repeat: b.repeat ? 1 : 0, include_threads: b.include_threads === false || b.include_threads === 0 ? 0 : 1 };
  };
  // ルールの対象に選べるもの: カテゴリと、テキストチャンネル(カテゴリごとに並べる)
  router.get('/targets', (req, res) => {
    const all = [...req.guild.channels.cache.values()];
    const cats = all.filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, channels: all.filter((x) => x.parentId === c.id && x.isTextBased() && !x.isThread()).length }));
    const chans = all.filter((c) => c.isTextBased() && !c.isThread()).sort((a, b) => a.rawPosition - b.rawPosition)
      .map((c) => ({ id: c.id, name: c.name, category: c.parentId ? req.guild.channels.cache.get(c.parentId)?.name ?? null : null }));
    res.json({ categories: cats, channels: chans });
  });
  router.get('/rules', (req, res) => res.json(getRules(req.guild.id)));
  router.post('/rules', (req, res) => {
    const r = parse(req); if (r.error) return res.status(400).json(r);
    if (getRules(req.guild.id).length >= 50) return res.status(400).json({ error: 'ルール数の上限(50)です' });
    res.json({ id: addRule(req.guild.id, r), ...r });
  });
  router.put('/rules/:rid', (req, res) => {
    const r = parse(req); if (r.error) return res.status(400).json(r);
    res.json({ ok: updateRule(req.guild.id, Number(req.params.rid), r) });
  });
  router.delete('/rules/:rid', (req, res) => res.json({ ok: deleteRule(req.guild.id, Number(req.params.rid)) }));
}
