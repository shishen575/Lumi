import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { version } from '../../core/version.js';
import { setupRestartNotice, getNotice, setNotice } from './restart-notice.js';
import { latencySummary } from '../../core/latency.js';
import { healthSnapshot, measureRest } from '../../core/health.js';

const GREEN = 0x57f287, YELLOW = 0xfee75c, RED = 0xed4245;
const up = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}日${h}時間` : h ? `${h}時間${m}分` : `${m}分`; };
const ms = (n) => (n == null || n < 0 ? '測定できません' : `${Math.round(n)}ms`);
const worst = (...v) => Math.max(0, ...v.filter((x) => typeof x === 'number' && x >= 0));

/** 通信の速さを調べる。ゲームやコマンドが遅いときの、原因調べにも使える */
export const pingCommand = {
  data: new SlashCommandBuilder().setName('ping').setDescription('BOTの応答速度(Discordとの通信・処理の止まり)を調べます')
    .setDMPermission(false)
    .addBooleanOption((o) => o.setName('private').setDescription('自分だけに表示する')),
  async execute(i) {
    const received = Date.now() - i.createdTimestamp; // コマンドを打ってから、BOTが受け取るまで
    const flags = i.options.getBoolean('private') ? { flags: MessageFlags.Ephemeral } : {};
    const t0 = Date.now();
    await i.reply({ content: '🏓 測定中…', ...flags });       // 3秒の期限があるので、先に返信してから、測る
    const replied = Date.now() - t0;                          // 返信(Discordへの送信)にかかった時間
    const rest = await measureRest(i.client);
    const gw = i.client.ws.ping;
    const st = healthSnapshot();
    const w = worst(gw, rest, received, replied, st.maxMs);
    const color = w < 500 ? GREEN : w < 1500 ? YELLOW : RED;
    const verdict = w < 500 ? '🟢 良好です' : w < 1500 ? '🟡 やや遅いです' : '🔴 遅いです。サーバーのネットワークや負荷を、確認してください';
    const mem = process.memoryUsage();
    let hist = null; try { hist = latencySummary(1); } catch { /* 記録がなくても動く */ }
    const embed = new EmbedBuilder().setColor(color).setTitle('🏓 Pong!').setDescription(verdict)
      .addFields(
        { name: '🌐 ゲートウェイ(往復)', value: ms(gw >= 0 ? gw : null), inline: true },
        { name: '🔁 通常の通信(REST)', value: ms(rest), inline: true },
        { name: '📨 コマンドが届くまで', value: ms(received), inline: true },
        { name: '💬 返信にかかった時間', value: ms(replied), inline: true },
        { name: '⚙️ 処理の止まり(直近1時間)', value: st.count ? `${st.count}回 / 最大 ${(st.maxMs / 1000).toFixed(1)}秒` : 'なし', inline: true },
        ...(hist?.n >= 3 ? [{ name: '📈 直近1時間(1分ごとの記録)', value: `ゲートウェイ 平均 ${ms(hist.gwAvg)} / 最大 ${ms(hist.gwMax)}\nREST 平均 ${ms(hist.restAvg)} / 最大 ${ms(hist.restMax)}\nコマンドが届くまで 最大 ${ms(hist.arrivalMax)} ・ 応答できなかったコマンド ${hist.missed}回`, inline: false }] : []),
        { name: '🖥️ BOT', value: `稼働 ${up(process.uptime())} ・ メモリ ${Math.round(mem.rss / 1048576)}MB ・ ${i.client.guilds.cache.size}サーバー`, inline: false },
      );
    if (version) embed.setFooter({ text: `バージョン ${version}` });
    await i.editReply({ content: '', embeds: [embed] });
  },
};

export default {
  name: 'status',
  title: 'ステータス',
  commands: [pingCommand],
  help: '`/ping` で、BOTの応答速度(Discordとの通信、コマンドが届くまでの遅れ、処理の止まり)を調べられます。',
  ui: '/dashboard/features/status.js',
  register({ client, router }) {
    setupRestartNotice(client);
    router.get('/settings', (req, res) => res.json(getNotice(req.guild.id)));
    router.put('/settings', (req, res) => {
      const id = req.body?.channel_id ? String(req.body.channel_id) : null;
      if (id) {
        const ch = req.guild.channels.cache.get(id);
        if (!ch?.isTextBased() || ch.isThread()) return res.status(400).json({ error: 'チャンネルが不正です' });
      }
      setNotice(req.guild.id, id);
      res.json(getNotice(req.guild.id));
    });
  },
};
