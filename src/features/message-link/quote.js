import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';

/** メッセージのリンク。<...> で囲まれたもの(プレビューを出さない書き方)は対象外にする */
const LINK = /(<)?https?:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(>)?/g;
export const MAX_LINKS = 3;

export function findLinks(content) {
  const seen = new Set(), out = [];
  for (const m of String(content ?? '').matchAll(LINK)) {
    if (m[1] && m[5]) continue; // <https://...> は、転送しない
    const key = `${m[2]}/${m[3]}/${m[4]}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ guildId: m[2], channelId: m[3], messageId: m[4], url: `https://discord.com/channels/${key}` });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

const IMAGE = /^image\/(png|jpe?g|gif|webp|avif)$/i;
const isImage = (a) => IMAGE.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(a.name ?? '');
/** 目隠し(ネタバレ)の添付ファイル。ファイル名が SPOILER_ で始まる */
export const isSpoiler = (a) => /^SPOILER_/i.test(a.name ?? '') || a.spoiler === true;
/** 本文の中で、||...|| の目隠しに入っているURL。画像のプレビューにしても、隠したままにするため、転送しない */
const spoileredUrls = (content) => {
  const set = new Set();
  for (const seg of String(content ?? '').matchAll(/\|\|([\s\S]*?)\|\|/g)) for (const u of seg[1].matchAll(/https?:\/\/[^\s<>|)]+/g)) set.add(u[0]);
  return set;
};
const cut = (s, n) => { const a = Array.from(s); return a.length > n ? `${a.slice(0, n - 1).join('')}…` : s; };

/**
 * リンク先のメッセージを、そのまま見せる埋め込みにする。文章・画像・添付ファイルを転送する(保存はしない)。
 * 画像は、同じURLを持つ埋め込みを並べて、1つのギャラリーにする(最大4枚)
 */
export function buildQuote(msg, url, { downloaded = new Map() } = {}) {
  const name = msg.member?.displayName ?? msg.author?.displayName ?? msg.author?.username ?? '不明なユーザー';
  const icon = msg.member?.displayAvatarURL?.() ?? msg.author?.displayAvatarURL?.();
  const text = cut(String(msg.content ?? ''), 3900); // ||ネタバレ|| は、そのまま(埋め込みの中でも、目隠しのまま表示される)

  const atts = [...(msg.attachments?.values?.() ?? [])];
  const images = atts.filter((a) => isImage(a) && !isSpoiler(a)).map((a) => a.url);   // 目隠しの画像は、埋め込みにしない(むき出しになる)
  const hidden = spoileredUrls(msg.content);
  for (const e of msg.embeds ?? []) { // 画像のURLを貼った場合などに、Discordが作る画像の埋め込み
    const u = e.thumbnail?.url ?? e.url;
    if ((e.data?.type ?? e.type) === 'image' && u && !hidden.has(e.url) && !hidden.has(u)) images.push(u);
  }
  const files = [], notes = [];
  const plain = atts.filter((a) => !isImage(a) && !isSpoiler(a));
  if (plain.length) notes.push(`📎 ${plain.map((a) => `[${cut(a.name, 40)}](${a.url})`).join(' ')}`);
  // 目隠しの添付: ダウンロードできたものは、目隠しのファイル名のまま添付し直す。できなければ、リンクを目隠しで包んで出す
  const spoilerLinks = [];
  for (const a of atts.filter(isSpoiler)) {
    const buf = downloaded.get(a.url);
    if (buf) files.push({ attachment: buf, name: /^SPOILER_/i.test(a.name) ? a.name : `SPOILER_${a.name}` });
    else spoilerLinks.push(`||[${cut(a.name, 40)}](${a.url})||`);
  }
  if (spoilerLinks.length) notes.push(`🙈 ${spoilerLinks.join(' ')}`);
  const stickers = [...(msg.stickers?.values?.() ?? [])];
  if (stickers.length) notes.push(`🏷️ スタンプ: ${stickers.map((s) => s.name).join('、')}`);

  const first = new EmbedBuilder()
    .setColor(msg.member?.displayColor || 0x6d5dfc)
    .setAuthor({ name: cut(name, 256), iconURL: icon, url })
    .setTimestamp(msg.createdTimestamp ?? Date.now())
    .setFooter({ text: `#${msg.channel?.name ?? '不明'}` });
  const body = [text, ...notes].filter(Boolean).join('\n\n');
  if (body) first.setDescription(body);
  else if (!images.length && !files.length) first.setDescription('(本文のないメッセージです)');

  const embeds = [first];
  if (images.length) {
    first.setURL(url).setImage(images[0]); // 同じURLの埋め込みは、Discordが1つにまとめて表示する
    for (const img of images.slice(1, 4)) embeds.push(new EmbedBuilder().setURL(url).setImage(img));
  }
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('元のメッセージへ').setURL(url));
  return { embeds, components: [row], files };
}

/** 目隠しの添付を、ダウンロードする(最大3つ・1つ8MBまで・合計20MBまで)。失敗したものは、含めない */
const MAX_FILE = 8 * 1024 * 1024, MAX_TOTAL = 20 * 1024 * 1024;
export async function downloadSpoilers(msg) {
  const out = new Map(); let total = 0;
  for (const a of [...(msg.attachments?.values?.() ?? [])].filter(isSpoiler).slice(0, 3)) {
    try {
      if ((a.size ?? 0) > MAX_FILE || total + (a.size ?? 0) > MAX_TOTAL) continue;
      const res = await fetch(a.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_FILE || total + buf.length > MAX_TOTAL) continue;
      total += buf.length; out.set(a.url, buf);
    } catch { /* 失敗したものは、隠したリンクで出す */ }
  }
  return out;
}

/**
 * 貼った本人が、そのメッセージを読める場所か。読めない場所の内容は、転送しない(情報漏えいの防止)。
 * dest: 転送先(貼られた)のチャンネル。成人向けチャンネルの内容は、成人向けでないチャンネルへ転送しない
 */
export async function canQuote({ source, dest, member, me }) {
  if (!source || !member) return false;
  const need = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  if (!source.permissionsFor(member)?.has(need)) return false;           // 貼った人が読めない
  if (!source.permissionsFor(me)?.has(need)) return false;               // BOTが読めない
  if (source.type === ChannelType.PrivateThread) {                       // 非公開スレッドは、メンバーだけ
    const m = await source.members.fetch(member.id).catch(() => null);
    if (!m) return false;
  }
  const nsfw = (c) => !!(c.nsfw ?? c.parent?.nsfw);
  if (nsfw(source) && !nsfw(dest)) return false;
  return true;
}
