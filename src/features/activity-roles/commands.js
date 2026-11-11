import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
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
  const total = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND ${col}>0`).get(guildId).c;
  if (mine <= 0) return { pos: null, total };
  const above = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND ${col}>?`).get(guildId, mine).c;
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
