// 草の絵文字の扱い。Unicodeの絵文字1つ、または「このサーバーの」カスタム絵文字だけ使える
const norm = (s) => (s ?? '').replace(/️/g, ''); // 異体字セレクタ(U+FE0F)の有無は無視して比べる

/** ボットがリアクションに使う形(カスタムはID、Unicodeはそのまま) */
export const toReaction = (e) => (e.id ?? e.name);
/** メッセージ内に表示する形 */
export const toDisplay = (e) => (e.id ? `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>` : e.name);

/** 投稿時に保存した絵文字と、付いたリアクションの絵文字が同じか */
export function sameEmoji(saved, reactionEmoji) {
  if (saved.emoji_id) return reactionEmoji.id === saved.emoji_id;
  return !reactionEmoji.id && norm(reactionEmoji.name) === norm(saved.emoji_name);
}

const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)/u;
/** 入力を絵文字に直す。不正なら null */
export function parseEmojiInput(input, guild) {
  const t = String(input ?? '').trim();
  const custom = /^<(a?):(\w{2,32}):(\d{17,20})>$/.exec(t);
  if (custom) return guild.emojis.cache.has(custom[3]) ? { id: custom[3], name: custom[2], animated: custom[1] === 'a' } : null;
  const graphemes = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(t)];
  if (graphemes.length !== 1 || !UNICODE_EMOJI.test(t)) return null;
  return { id: null, name: t, animated: false };
}
