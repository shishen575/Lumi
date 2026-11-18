import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { isOperator, canEditAccess } from '../../core/access.js';
import { fieldsOf, createPairing, listIntegrations, revoke, saveConfig, CAPS, PAIR_TTL_MS } from '../../core/integrations.js';

const EPH = { flags: MessageFlags.Ephemeral };
const base = () => (process.env.BASE_URL || '').replace(/\/+$/, '');
const canManage = (i) => isOperator(i.user.id) || i.guild?.ownerId === i.user.id || i.memberPermissions?.has(PermissionFlagsBits.Administrator);
const stamp = (t) => `<t:${Math.floor(t / 1000)}:R>`;

/** トークンを、この1回だけ見せる(コマンド・ダッシュボード共通) */
export const pairingText = (token, expiresAt) => [
  `接続用トークン(**この1回しか、表示されません**。${PAIR_TTL_MS / 60000}分で、使えなくなります):`, '```', token, '```',
  `相手のサイトの「Lumi連携」に、次の2つを貼ってください。`, `・接続先: \`${base() || 'https://(このBOTのアドレス)'}/internal/register\``, `・トークン: 上のもの`,
  `相手のサイトが、必要な機能を送ってくると、ダッシュボードの「連携」に、設定の画面が、自動でできます(有効期限 ${stamp(expiresAt)})。`,
].join('\n');

export const integrationCommand = {
  data: new SlashCommandBuilder().setName('integration').setDescription('【管理者向け】外のサイトとの連携(接続用トークンを出します)').setDMPermission(false)
    .addSubcommand((c) => c.setName('create').setDescription('接続用トークンを発行します(相手のサイトに貼ります)').addStringOption((o) => o.setName('name').setDescription('連携の名前(例: めし帖)').setRequired(true).setMaxLength(30)))
    .addSubcommand((c) => c.setName('list').setDescription('連携の一覧を見ます'))
    .addSubcommand((c) => c.setName('revoke').setDescription('連携を、削除します(相手は、使えなくなります)').addStringOption((o) => o.setName('id').setDescription('連携のID(/integration list で見えます)').setRequired(true).setMaxLength(40))),
  async execute(i) {
    if (!canManage(i)) return i.reply({ content: '連携を扱えるのは、サーバーのオーナー・管理者だけです。', ...EPH });
    const sub = i.options.getSubcommand();
    if (sub === 'create') {
      const r = createPairing(i.guildId, i.options.getString('name', true), i.user.id);
      if (r.error) return i.reply({ content: r.error, ...EPH });
      return i.reply({ content: pairingText(r.token, r.expiresAt), ...EPH });
    }
    if (sub === 'list') {
      const rows = listIntegrations(i.guildId);
      if (!rows.length) return i.reply({ content: 'まだ、連携はありません。`/integration create` で、接続用トークンを出せます。', ...EPH });
      const e = new EmbedBuilder().setColor(0x6d5dfc).setTitle('🔌 連携').addFields(rows.map((r) => ({ name: `${r.name}(\`${r.id}\`)`, value: r.status === 'waiting' ? `相手の接続を、待っています(${r.pairExp > Date.now() ? '期限 ' + stamp(r.pairExp) : '期限切れ'})` : `${r.manifest.capabilities.map((c) => `${r.config.enabled?.[c] ? '✅' : '⬜'} ${CAPS[c].label}`).join(' / ') || '機能なし'}\n-# 最後の通信: ${r.lastSeen ? stamp(r.lastSeen) : 'まだありません'}` })))
        .setFooter({ text: '機能のオン・チャンネル・ロールは、ダッシュボードの「連携」で決めます' });
      return i.reply({ embeds: [e], ...EPH });
    }
    return i.reply({ content: revoke(i.guildId, i.options.getString('id', true).trim()) ? '🗑️ 連携を、削除しました。相手は、もう使えません。' : 'その連携は、見つかりません。', ...EPH });
  },
};

const isText = (c) => (!!c?.isTextBased?.() && !c.isVoiceBased?.()) || c?.type === 15 || c?.type === 16; // スレッド・フォーラムも、可

export default {
  name: 'integrations',
  title: '連携',
  ui: '/dashboard/features/integrations.js',
  help: '外のサイトと連携します。`/integration create` で出した接続用トークンを、相手のサイトに貼ると、相手が使いたい機能が届き、ダッシュボードに設定の画面が自動でできます。',
  commands: [integrationCommand],
  register({ router }) {
    const adminOnly = (req, res, next) => (canEditAccess(req.access) ? next() : res.status(403).json({ error: '連携を扱えるのは、サーバーのオーナー・管理者・運営だけです' }));
    router.get('/', (req, res) => res.json({ caps: CAPS, ttlMin: PAIR_TTL_MS / 60000, base: base(), items: listIntegrations(req.guild.id) }));
    router.get('/channels', (req, res) => res.json(req.guild.channels.cache.filter(isText).map((c) => ({ id: c.id, name: c.isThread() ? `${c.parent?.name ?? '?'} › ${c.name}` : c.type === 15 || c.type === 16 ? `${c.name}(フォーラム)` : c.name, type: c.type })).sort((a, b) => a.name.localeCompare(b.name))));
    router.post('/pair', adminOnly, (req, res) => {
      const r = createPairing(req.guild.id, req.body?.name, req.actor?.id ?? req.session?.user?.id);
      if (r.error) return res.status(400).json({ error: r.error });
      res.json({ id: r.id, token: r.token, expiresAt: r.expiresAt });
    });
    router.put('/:id', adminOnly, (req, res) => {
      const g = req.guild, me = g.members.me, values = { ...(req.body?.values ?? {}) };
      for (const [k, v] of Object.entries(values)) { // チャンネル・ロールは、このサーバーにあるものだけ
        if (!/^\d{15,25}$/.test(String(v ?? ''))) continue;
        const asChannel = g.channels.cache.get(String(v)), asRole = g.roles.cache.get(String(v));
        const it = listIntegrations(g.id).find((x) => x.id === req.params.id), field = it && fieldsOf(it).find((f) => f.key === k);
        if (field?.type === 'channel' && !isText(asChannel)) values[k] = '';
        if (field?.type === 'role' && (!asRole || asRole.managed || asRole.id === g.id || asRole.position >= me.roles.highest.position)) values[k] = '';
      }
      const out = saveConfig(g.id, req.params.id, { enabled: req.body?.enabled, values });
      if (!out) return res.status(404).json({ error: '連携が見つかりません' });
      res.json({ ok: true, item: out });
    });
    router.delete('/:id', adminOnly, (req, res) => (revoke(req.guild.id, req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: '連携が見つかりません' })));
  },
};
