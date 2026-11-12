import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getCommandId } from '../../core/commands.js';
import { kusaEmoji, roundById, moveRound } from './db.js';
import { toDisplay } from './emoji.js';

export const ANSWER_BUTTON = 'ogiri:answer'; // 他の機能と衝突しないよう、名前空間を付ける
export const NO_MENTIONS = { parse: [] };    // お題・回答・名前の中のメンションで、通知が飛ばないように

/** 押せるコマンド表記。IDが分からないときは、文字だけ */
export const commandLink = (guildId, name) => {
  const id = getCommandId(guildId, name);
  return id ? `</${name}:${id}>` : `\`/${name}\``;
};

export const odaiContent = (guildId, odai) =>
  `📢 **お題**\n${odai.split('\n').map((l) => `> ${l}`).join('\n')}\n` +
  `-# 回答は ${commandLink(guildId, 'kaitou')} (a に回答を入力) か、下のボタンから / 草は ${toDisplay(kusaEmoji(guildId))} をリアクションで`;

export const answerRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(ANSWER_BUTTON).setLabel('回答する').setEmoji('✍️').setStyle(ButtonStyle.Primary));

/** お題を一番下に出し直す。回答も草も、そのまま引き継がれる */
const locks = new Set(); // 同じお題を同時に再掲しない
export async function bumpRound(client, roundId) {
  if (locks.has(roundId)) return false;
  locks.add(roundId);
  try {
    const r = roundById(roundId);
    if (!r || r.ended) return false;
    const guild = client.guilds.cache.get(r.guild_id);
    const ch = guild && (guild.channels.cache.get(r.channel_id) ?? await guild.channels.fetch(r.channel_id).catch(() => null));
    if (!ch) return false;
    const msg = await ch.send({ content: odaiContent(r.guild_id, r.odai), components: [answerRow()], allowedMentions: NO_MENTIONS });
    await ch.messages.delete(r.msg_id).catch(() => {}); // 古いお題は消す(失敗しても無視)
    moveRound(roundId, msg.id);
    return true;
  } finally { locks.delete(roundId); }
}
