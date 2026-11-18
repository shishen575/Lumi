import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { loadNotes } from '../../core/release-notes.js';
import { version } from '../../core/version.js';
import { setupRestartNotice, getNotice, setNotice } from './restart-notice.js';
import { latencySummary } from '../../core/latency.js';
import { storageWarning } from '../../core/storage-check.js';
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
    const sw = storageWarning(); if (sw) embed.addFields({ name: '⚠️ データの保存', value: sw, inline: false }); // ボリュームがないと、再デプロイでデータが消える
    if (version) embed.setFooter({ text: `バージョン ${version}` });
    await i.editReply({ content: '', embeds: [embed] });
  },
};

/* ================= リリースノート(/releasenotes) ================= */
const MAX_CHOICES = 25; // Discord の、選択肢の上限
const notesAtLoad = loadNotes(); // 起動時のリリースノート。コマンドの選択肢(プルダウン)に使う(更新のたびに、BOTが再起動して、選択肢も作り直される)
const label = (n) => `v${n.n} ${n.date} ${n.title}`.slice(0, 100);
/** 1つの版を、埋め込みにする。page = 新しい順の位置(0 が最新) */
export function notesEmbed(notes, page) {
  const n = notes[page], base = process.env.BASE_URL?.replace(/\/+$/, '');
  const body = n.items.map((it) => `・**${it.tag ?? '更新'}** ${it.text}`).join('\n');
  return new EmbedBuilder().setColor(0x6d5dfc).setTitle(`📝 リリースノート v${n.n}`)
    .setDescription(`**${n.title}**(${n.date})\n\n${body.length > 3800 ? body.slice(0, 3797) + '…' : body}`)
    .setFooter({ text: `${page + 1} / ${notes.length}(新しい順)${page === 0 ? ' ・ 最新' : ''}${base ? ` ・ 更新履歴: ${base}/changelog.html` : ''}${version ? ` ・ 実行中 ${version}` : ''}` });
}
// ボタンの識別番号(custom_id)は、1つのメッセージの中で、重複してはいけない(重複すると、Discordがエラーにする)。動作の名前を、末尾に付けて、必ず別にする
const navRow = (notes, page, uid) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`rn:0:${uid}:first`).setEmoji('⏮').setLabel('最新').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
  new ButtonBuilder().setCustomId(`rn:${Math.max(0, page - 1)}:${uid}:prev`).setLabel('新しい版').setStyle(ButtonStyle.Primary).setDisabled(page <= 0),
  new ButtonBuilder().setCustomId(`rn:${Math.min(notes.length - 1, page + 1)}:${uid}:next`).setLabel('古い版').setStyle(ButtonStyle.Primary).setDisabled(page >= notes.length - 1),
);
export const releaseNotesCommand = {
  data: (() => {
    const b = new SlashCommandBuilder().setName('releasenotes').setDescription('リリースノート(更新内容)を見ます').setDMPermission(false);
    b.addIntegerOption((o) => { o.setName('version').setDescription('見たい版(省略すると、最新)'); if (notesAtLoad.length) o.addChoices(...notesAtLoad.slice(0, MAX_CHOICES).map((n) => ({ name: label(n), value: n.n }))); return o; });
    b.addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけ)'));
    return b;
  })(),
  async execute(i) {
    const notes = loadNotes(); // 最新の内容を読み直す
    if (!notes.length) return i.reply({ content: 'リリースノートは、まだありません。', flags: MessageFlags.Ephemeral });
    const want = i.options.getInteger('version'), page = want === null ? 0 : Math.max(0, notes.findIndex((n) => n.n === want));
    await i.reply({ embeds: [notesEmbed(notes, page)], components: [navRow(notes, page, i.user.id)], ...(i.options.getBoolean('public') ? {} : { flags: MessageFlags.Ephemeral }) });
  },
};
export const releaseNotesButton = {
  id: 'rn',
  async execute(i) {
    const [, pageS, uid] = i.customId.split(':');
    if (i.user.id !== uid) return i.reply({ content: 'コマンドを実行した人だけが、操作できます。`/releasenotes` で、自分用に開けます。', flags: MessageFlags.Ephemeral });
    const notes = loadNotes(); if (!notes.length) return i.update({ content: 'リリースノートは、まだありません。', embeds: [], components: [] });
    const page = Math.min(notes.length - 1, Math.max(0, Number(pageS) || 0));
    await i.update({ embeds: [notesEmbed(notes, page)], components: [navRow(notes, page, uid)] });
  },
};

export default {
  name: 'status',
  title: 'ステータス',
  commands: [pingCommand, releaseNotesCommand],
  components: [releaseNotesButton],
  help: '`/releasenotes` で、更新内容(リリースノート)を、版を選んで見られます。\n`/ping` で、BOTの応答速度(Discordとの通信、コマンドが届くまでの遅れ、処理の止まり)を調べられます。',
  ui: '/dashboard/features/status.js',
  register({ client, router }) {
    setupRestartNotice(client);
    router.get('/settings', (req, res) => res.json(getNotice(req.guild.id)));
    router.put('/settings', (req, res) => {
      const id = req.body?.channel_id ? String(req.body.channel_id) : null;
      if (id) {
        const ch = req.guild.channels.cache.get(id);
        if (!ch?.isTextBased() || ch.isVoiceBased()) return res.status(400).json({ error: 'チャンネルが不正です' });
      }
      setNotice(req.guild.id, id);
      res.json(getNotice(req.guild.id));
    });
  },
};
