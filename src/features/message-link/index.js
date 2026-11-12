import { Events, GatewayIntentBits } from 'discord.js';
import { findLinks, buildQuote, canQuote, downloadSpoilers } from './quote.js';
import { mountApi } from './api.js';
import { getSettings } from './settings.js';

let warnedEmpty = false;
const lastByUser = new Map();   // 連投の防止(ユーザーごとに5秒)
const lastByLink = new Map();   // 同じメッセージを続けて転送しない(チャンネルごとに30秒)
const USER_COOLDOWN = 5_000, LINK_COOLDOWN = 30_000;

/** サーバーでメッセージのリンクが貼られたら、元のメッセージの文章と画像を、そのまま転送する。既定はオフ(ダッシュボードで有効にする) */
export default {
  name: 'message-link',
  title: 'メッセージリンク',
  ui: '/dashboard/features/message-link.js',
  help: 'メッセージのリンクを貼ると、元のメッセージの文章と画像を、そのまま転送します(管理者が有効にしたサーバーのみ)。',

  register({ client, router }) {
    mountApi(router, client);
    client.once(Events.ClientReady, () => {
      const on = client.options.intents.has(GatewayIntentBits.MessageContent);
      console.log(`[message-link] メッセージ本文の読み取り(MESSAGE CONTENT INTENT): ${on ? '有効' : '無効 → 環境変数 MESSAGE_CONTENT_INTENT=1 が必要です(Developer Portal でオンにしてから)'}`);
    });
    // 反応しなかった理由を、ログに残す(本文は出さない)。リンクが貼られたときだけなので、量は少ない
    const why = (m, reason) => console.log(`[message-link] ${m.guild?.name ?? m.guildId} #${m.channel?.name ?? m.channelId}: 転送しませんでした(${reason})`);

    client.on(Events.MessageCreate, async (message) => {
      try {
        if (!message.guildId || message.author.bot || message.webhookId) return;
        if (!message.content) { // 本文が空: MESSAGE CONTENT INTENT が無効だと、ユーザーの発言の本文は、すべて空で届く
          if (!warnedEmpty && !client.options.intents.has(GatewayIntentBits.MessageContent) && !message.attachments?.size) {
            warnedEmpty = true;
            console.warn('[message-link] メッセージの本文が空で届いています。MESSAGE CONTENT INTENT が無効のため、リンクを見つけられません(環境変数 MESSAGE_CONTENT_INTENT=1 が必要です)');
          }
          return;
        }
        const found = findLinks(message.content);
        if (!found.length) return;
        if (!getSettings(message.guildId).enabled) return why(message, 'このサーバーでは、ダッシュボードでオフになっています');
        const links = found.filter((l) => l.guildId === message.guildId); // 他のサーバーのリンクは対象外
        if (!links.length) return why(message, `他のサーバーのリンクです(リンクのサーバーID ${found[0].guildId} / ここのサーバーID ${message.guildId})`);
        const now = Date.now();
        if (now - (lastByUser.get(message.author.id) ?? 0) < USER_COOLDOWN) return why(message, '連投のため(5秒の間隔)');
        lastByUser.set(message.author.id, now);
        for (const [k, t] of lastByLink) if (now - t > LINK_COOLDOWN) lastByLink.delete(k);

        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        const embeds = [], rows = [], files = [];
        for (const l of links) {
          const key = `${message.channelId}:${l.messageId}`;
          if (lastByLink.has(key)) { why(message, '同じメッセージを続けて転送しないため(30秒)'); continue; }
          const source = message.guild.channels.cache.get(l.channelId) ?? await message.guild.channels.fetch(l.channelId).catch(() => null);
          if (!source?.messages) { why(message, 'リンク先のチャンネルが見つかりません(BOTが見られないチャンネルかもしれません)'); continue; }
          if (!await canQuote({ source, dest: message.channel, member, me: message.guild.members.me })) { why(message, '権限がありません(貼った人かBOTが、リンク先のチャンネルを見られない/履歴を読めない、または成人向けの制限)'); continue; }
          const original = await source.messages.fetch(l.messageId).catch((e) => { why(message, `リンク先のメッセージを取得できませんでした(${e.message})`); return null; });
          if (!original) continue;
          lastByLink.set(key, now);
          const q = buildQuote(original, l.url, { downloaded: await downloadSpoilers(original) }); // 目隠しのものは、隠したまま転送する
          embeds.push(...q.embeds); rows.push(...q.components); files.push(...q.files);
        }
        if (!embeds.length) return;
        await message.reply({ embeds: embeds.slice(0, 10), components: rows.slice(0, 5), files: files.slice(0, 10), allowedMentions: { parse: [], repliedUser: false } });
      } catch (e) { console.warn('[message-link]', e.message); }
    });
  },
};
