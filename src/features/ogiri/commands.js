import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { hasAccessSync } from '../../core/access.js';
import {
  kusaEmoji, setKusaEmoji, DEFAULT_EMOJI, activeRound, roundIdByMsg, createRound, endRound, countAnswer, hasSameAnswer, addPost,
  postsOfRound, lastPostInChannel, bestPost, ranking,
} from './db.js';
import { toReaction, toDisplay, parseEmojiInput } from './emoji.js';
import { odaiContent, answerRow, commandLink, bumpRound, NO_MENTIONS, ANSWER_BUTTON } from './round.js';
import { speakFor } from './tts.js';

const EPH = { flags: MessageFlags.Ephemeral }; // 本人にだけ表示
const MEDAL = ['🥇', '🥈', '🥉'];
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const a = Array.from(s); return a.length > n ? `${a.slice(0, n).join('')}…` : s; };

/** 回答に付けた草を数える間隔などの設定(環境変数)。0 で無効 */
const envInt = (name, def) => { const v = process.env[name]; return v === undefined || v === '' ? def : Math.max(0, Number.parseInt(v, 10) || 0); };
export const bumpEvery = () => envInt('BUMP_EVERY', 5);

// 直近10分に受け付けた回答(重複投稿の防止)。同時に届いても重複しないよう、投稿より前に同期的に登録する
const recent = new Map();
const RECENT_MS = 10 * 60 * 1000;
function remember(key) {
  const now = Date.now();
  for (const [k, t] of recent) if (now - t > RECENT_MS) recent.delete(k);
  recent.set(key, now);
}

/** 仕様どおり、ギルド内のみ。DMでは使えない */
const guildOnly = (b) => b.setDMPermission(false);

export const odaiCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('odai').setDescription('大喜利のお題を出します')
    .addStringOption((o) => o.setName('text').setDescription('お題').setRequired(true).setMaxLength(500))),
  async execute(i) {
    const odai = i.options.getString('text', true).trim();
    // 3秒ルール: 先にお題を投稿してから、記録する
    await i.reply({ content: odaiContent(i.guildId, odai), components: [answerRow()], allowedMentions: NO_MENTIONS });
    const msg = await i.fetchReply();
    createRound({ guildId: i.guildId, channelId: i.channelId, odai, msgId: msg.id }); // 進行中のお題があれば、終了扱いになる
    speakFor('odai', i.guildId, i.channelId, [{ text: `お題。${odai}` }], `odai:${msg.id}`); // 読み上げ連携(オンのサーバーのみ。送りっぱなし)
  },
};

export const answerButton = {
  id: ANSWER_BUTTON,
  async execute(i) {
    // 押されたメッセージのお題が、このチャンネルの今のお題か(再掲で古くなったメッセージのボタンも、今のお題として扱う)
    const rid = roundIdByMsg(i.message.id);
    const active = activeRound(i.guildId, i.channelId);
    if (!rid || !active || active.round_id !== rid) return i.reply({ content: 'このお題は終了しています', ...EPH });
    await i.reply({ content: `下のコマンドを押して、a に回答を入力して送ってね\n${commandLink(i.guildId, 'kaitou')}`, ...EPH });
  },
};

export const kaitouCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('kaitou').setDescription('今のお題に回答します')
    .addStringOption((o) => o.setName('a').setDescription('回答(300文字まで)').setRequired(true).setMinLength(1).setMaxLength(300))),
  async execute(i) {
    const round = activeRound(i.guildId, i.channelId);
    if (!round) return i.reply({ content: 'このチャンネルに進行中のお題がありません', ...EPH });
    const text = i.options.getString('a', true);
    const key = `${i.guildId}:${round.round_id}:${i.user.id}:${text}`;
    if (hasSameAnswer(round.round_id, i.user.id, text) || recent.has(key)) {
      return i.reply({ content: '同じ回答はすでに投稿されています', ...EPH });
    }
    remember(key); // 投稿より前に、同期的に登録する
    try { await i.reply({ content: '投稿しました', ...EPH }); } // 先に、本人にだけ返す(3秒ルール)
    catch (e) { recent.delete(key); throw e; }

    try {
      const ch = i.channel ?? await i.guild.channels.fetch(i.channelId);
      const emoji = kusaEmoji(i.guildId);
      const name = i.member?.displayName ?? i.user.username;
      // 返信ではなく、普通のメッセージとして投稿する(元のお題が消えても「メッセージが読み込めません」が出ない)
      const msg = await ch.send({
        embeds: [new EmbedBuilder().setColor(0x57f287).addFields(
          { name: 'ユーザー名', value: name.slice(0, 256) || '-' }, { name: 'お題', value: round.odai.slice(0, 1024) }, { name: '内容', value: text })],
        allowedMentions: NO_MENTIONS,
      });
      addPost({ msgId: msg.id, guildId: i.guildId, channelId: i.channelId, roundId: round.round_id, uid: i.user.id, name, odai: round.odai, text, emoji });
      speakFor('answer', i.guildId, i.channelId, [{ text, user_id: i.user.id, say_name: true }], `answer:${msg.id}`); // 回答者本人の声・速度で読む
      await msg.react(toReaction(emoji)).catch((e) => console.warn('[ogiri] 草のリアクションを付けられませんでした:', e.message)); // 付けられなくても、回答は有効
      const every = bumpEvery();
      if (every > 0 && countAnswer(round.round_id) >= every) bumpRound(i.client, round.round_id).catch((e) => console.error('[ogiri] 再掲に失敗:', e.message));
    } catch (e) {
      recent.delete(key);
      console.error('[ogiri] 回答の投稿に失敗:', e.message);
      await i.followUp({ content: '回答を投稿できませんでした。BOTの権限(メッセージを送信・埋め込みリンク)を確認してください。', ...EPH }).catch(() => {});
    }
  },
};

export const kekkaCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('kekka').setDescription('今のお題の結果(草の多い順TOP10)を発表して、お題を終わります')),
  async execute(i) {
    await i.deferReply(); // 先に応答を保留する(3秒ルール)
    const round = activeRound(i.guildId, i.channelId);
    let posts, odai;
    if (round) { posts = postsOfRound(round.round_id); odai = round.odai; }
    else { // 今のお題の記録が無いとき(前回の結果の送信に失敗したなど)は、最後に回答があったお題を集める
      const last = lastPostInChannel(i.guildId, i.channelId);
      posts = last ? postsOfRound(last.round_id) : []; odai = last?.odai;
    }
    if (!posts.length) return i.editReply('集計できる回答がありません');
    const lines = posts.slice(0, 10).map((p, n) =>
      `${MEDAL[n] ?? `${n + 1}.`} 草${p.votes}人 「${cut(oneLine(p.text), 80)}」 — ${p.name}`);
    const more = posts.length > 10 ? `\n-# 全${posts.length}件中 TOP10 を表示` : '';
    await i.editReply({ content: `🏆 **結果** お題: ${cut(oneLine(odai), 200)}\n\n${lines.join('\n')}${more}`, allowedMentions: NO_MENTIONS });
    if (round) endRound(round.round_id); // 結果を送れてから終了する(送信に失敗したら、ここには来ない)
    // 結果の読み上げ(TOP3): 「結果発表」→ 各順位「N位、草○人。」→ 回答を、回答者の声で
    const items = [{ text: '結果発表。' }];
    posts.slice(0, 3).forEach((p, n) => items.push({ text: `${n + 1}位、草${p.votes}人。` }, { text: p.text, user_id: p.uid, say_name: true }));
    speakFor('result', i.guildId, i.channelId, items, `kekka:${round?.round_id ?? posts[0].round_id}`);
  },
};

export const rankingCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('ranking').setDescription('大喜利のサーバーランキング(回答数と、もらった草の数)')),
  async execute(i) {
    const rows = ranking(i.guildId, 10);
    if (!rows.length) return i.reply({ content: 'まだ回答がありません', ...EPH });
    const lines = rows.map((r, n) => `${MEDAL[n] ?? `${n + 1}.`} <@${r.uid}>  回答数${r.answers} : 草${r.kusa}`);
    await i.reply({ content: `🌱 **サーバーランキング(回答数 : 草の数)**\n\n${lines.join('\n')}`, allowedMentions: NO_MENTIONS });
  },
};

export const bestCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('best').setDescription('サーバー内で一番草が入っている投稿を表示します')),
  async execute(i) {
    const p = bestPost(i.guildId);
    if (!p) return i.reply({ content: 'まだ回答がありません', ...EPH });
    if (!p.votes) return i.reply({ content: 'まだ草が入っている投稿がありません', ...EPH });
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 サーバー内で一番草が入っている投稿').addFields(
      { name: 'ユーザー名', value: p.name.slice(0, 256) || '-' }, { name: 'お題', value: p.odai.slice(0, 1024) },
      { name: '内容', value: p.text }, { name: '草', value: `${p.votes}人` });
    const link = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('元の投稿を見る')
      .setURL(`https://discord.com/channels/${p.guild_id}/${p.channel_id}/${p.msg_id}`));
    await i.reply({ embeds: [embed], components: [link], allowedMentions: NO_MENTIONS });
  },
};

export const kusaemojiCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('kusaemoji').setDescription('草として数える絵文字を設定します(省略すると ☑️ に戻します)')
    .addStringOption((o) => o.setName('emoji').setDescription('絵文字(Unicodeの絵文字、またはこのサーバーのカスタム絵文字)'))),
  async execute(i) {
    // 誰でも変えられると、数え方を荒らされるので、ダッシュボードを操作できる人(オーナー・管理者・管理ロール・運営)だけ
    if (!hasAccessSync(i.guild, i.member, i.user.id)) {
      return i.reply({ content: '草の絵文字を変えられるのは、サーバーの管理者(または管理ロールを持つ人)だけです', ...EPH });
    }
    const input = i.options.getString('emoji');
    const emoji = input === null ? DEFAULT_EMOJI : parseEmojiInput(input, i.guild);
    if (!emoji) return i.reply({ content: '絵文字を1つだけ入力してね(カスタム絵文字は、このサーバー、またはLumiが入っているサーバーのものが使えます。Lumiが入っていないサーバーの絵文字は使えません)', ...EPH });
    setKusaEmoji(i.guildId, emoji);
    await i.reply(`草の絵文字を ${toDisplay(emoji)} にしました。これ以降の回答から、この絵文字のリアクションで草を数えます`);
  },
};

export const upCommand = {
  data: guildOnly(new SlashCommandBuilder().setName('up').setDescription('今のお題を、チャンネルの一番下に出し直します')),
  async execute(i) {
    const round = activeRound(i.guildId, i.channelId);
    if (!round) return i.reply({ content: 'このチャンネルに進行中のお題がありません', ...EPH });
    await i.reply({ content: 'お題を一番下に出し直します', ...EPH });
    await bumpRound(i.client, round.round_id).catch((e) => console.error('[ogiri] 再掲に失敗:', e.message));
  },
};

export const commands = [odaiCommand, kaitouCommand, kekkaCommand, rankingCommand, bestCommand, kusaemojiCommand, upCommand];
