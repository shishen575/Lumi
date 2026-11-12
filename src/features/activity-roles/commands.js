import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db } from '../../core/db.js';
import { METRICS, getRules, getStats, metricValue } from './db.js';

const COL = { messages: 'messages', reactions_received: 'reactions_received', reactions_given: 'reactions_given', voice_minutes: 'voice_seconds' };
const UNIT = { messages: '回', reactions_received: '個', reactions_given: '個', voice_minutes: '分' };

const fmt = (metric, v) => {
  if (metric !== 'voice_minutes') return `${v.toLocaleString()}${UNIT[metric]}`;
  const h = Math.floor(v / 60), m = v % 60;
  return h ? `${h}時間${m}分` : `${m}分`;
};

/** サーバー内の順位(同数は同順位) */
function position(guildId, metric, userId) {
  const col = COL[metric];
  const mine = db.prepare(`SELECT ${col} AS v FROM stats WHERE guild_id=? AND user_id=?`).get(guildId, userId)?.v ?? 0;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>0`).get(guildId).c;
  if (mine <= 0) return { pos: null, total };
  const above = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>?`).get(guildId, mine).c;
  return { pos: above + 1, total };
}

export const rankCommand = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('発言数・順位・ランク・次のランクまでの必要数を表示します')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('見たい相手(省略すると自分)'))
    .addBooleanOption((o) => o.setName('private').setDescription('自分だけに表示する')),

  async execute(i) {
    const user = i.options.getUser('user') ?? i.user;
    if (user.bot) return i.reply({ content: 'BOTは集計対象外です。', ephemeral: true });
    const gid = i.guildId;
    const stats = getStats(gid, user.id);
    const rules = getRules(gid);
    const metrics = Object.keys(METRICS).filter((m) => m === 'messages' || rules.some((r) => r.metric === m));

    const fields = metrics.map((metric) => {
      const v = metricValue(stats, metric);
      const { pos, total } = position(gid, metric, user.id);
      const tiers = rules.filter((r) => r.metric === metric).sort((a, b) => a.threshold - b.threshold);
      const cur = [...tiers].reverse().find((r) => r.threshold <= v);
      const next = tiers.find((r) => r.threshold > v);
      const lines = [
        `**${fmt(metric, v)}**`,
        `順位: ${pos ? `**${pos}位** / ${total}人` : '圏外'}`,
      ];
      if (tiers.length) {
        lines.push(`ランク: ${cur ? `<@&${cur.role_id}>` : 'なし'}`);
        lines.push(next
          ? `次: <@&${next.role_id}> まであと **${fmt(metric, next.threshold - v)}**(${fmt(metric, next.threshold)}で到達)`
          : '次: 最高ランクに到達しています 🎉');
      }
      return { name: METRICS[metric], value: lines.join('\n'), inline: false };
    });

    const embed = new EmbedBuilder()
      .setAuthor({ name: (i.options.getMember('user') ?? i.member)?.displayName ?? user.username, iconURL: user.displayAvatarURL() })
      .setColor(0x6d5dfc)
      .addFields(fields);
    await i.reply({ embeds: [embed], ephemeral: i.options.getBoolean('private') ?? false });
  },
};

// ---------- /top : ランキング(10位ごとにページ送り) ----------
const PAGE = 10;

function pageData(gid, metric, page) {
  const col = COL[metric];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>0`).get(gid).c;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const rows = db.prepare(
    `SELECT user_id, v, rk FROM (
       SELECT user_id, ${col} AS v, RANK() OVER (ORDER BY ${col} DESC) AS rk FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>0
     ) ORDER BY v DESC, user_id LIMIT ? OFFSET ?`
  ).all(gid, PAGE, (p - 1) * PAGE);
  return { rows, total, pages, page: p };
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

async function renderTop(i, metric, page) {
  const gid = i.guildId;
  const d = pageData(gid, metric, page);
  const found = d.rows.length
    ? await i.guild.members.fetch({ user: d.rows.map((r) => r.user_id) }).catch(() => new Map())
    : new Map();
  const val = (v) => fmt(metric, metric === 'voice_minutes' ? Math.floor(v / 60) : v);
  const lines = d.rows.map((r) =>
    `${MEDAL[r.rk] ?? `**${r.rk}位**`} ${found.get?.(r.user_id) ? `<@${r.user_id}>` : '(退出したユーザー)'} — ${val(r.v)}`);
  const mine = position(gid, metric, i.user.id);
  const embed = new EmbedBuilder()
    .setColor(0x6d5dfc)
    .setTitle(`🏆 ${METRICS[metric]}ランキング`)
    .setDescription(lines.join('\n') || 'まだデータがありません')
    .setFooter({ text: `${d.page} / ${d.pages} ページ ・ あなた: ${mine.pos ? `${mine.pos}位` : '圏外'}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('top:first').setEmoji('⏮').setStyle(ButtonStyle.Secondary).setDisabled(d.page <= 1),
    new ButtonBuilder().setCustomId('top:prev').setLabel('前へ').setStyle(ButtonStyle.Primary).setDisabled(d.page <= 1),
    new ButtonBuilder().setCustomId('top:next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(d.page >= d.pages),
    new ButtonBuilder().setCustomId('top:last').setEmoji('⏭').setStyle(ButtonStyle.Secondary).setDisabled(d.page >= d.pages),
  );
  return { embeds: [embed], components: d.pages > 1 ? [row] : [], page: d.page, pages: d.pages };
}

export const topCommand = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('ランキングを10位ごとに表示します')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('metric').setDescription('何のランキングか(省略すると発言数)')
      .addChoices(...Object.entries(METRICS).map(([value, name]) => ({ name, value }))))
    .addIntegerOption((o) => o.setName('page').setDescription('開くページ(省略すると1)').setMinValue(1))
    .addBooleanOption((o) => o.setName('private').setDescription('自分だけに表示する')),

  async execute(i) {
    const metric = i.options.getString('metric') ?? 'messages';
    let page = i.options.getInteger('page') ?? 1;
    const view = await renderTop(i, metric, page);
    page = view.page;
    const msg = await i.reply({ embeds: view.embeds, components: view.components,
      ephemeral: i.options.getBoolean('private') ?? false, fetchReply: true });
    if (!view.components.length) return;

    // ボタンは実行した本人だけが操作できる(2分操作がなければ無効化)
    const collector = msg.createMessageComponentCollector({ idle: 120_000, time: 600_000 });
    collector.on('collect', async (b) => {
      if (b.user.id !== i.user.id) return b.reply({ content: 'コマンドを実行した人だけがページを切り替えられます。`/top` で自分用に開けます。', ephemeral: true });
      const cur = await renderTop(i, metric, page);
      const to = { 'top:first': 1, 'top:prev': page - 1, 'top:next': page + 1, 'top:last': cur.pages }[b.customId] ?? page;
      const next = await renderTop(i, metric, to);
      page = next.page;
      await b.update({ embeds: next.embeds, components: next.components });
    });
    collector.on('end', () => i.editReply({ components: [] }).catch(() => {}));
  },
};
