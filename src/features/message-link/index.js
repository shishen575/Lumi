import { Events } from 'discord.js';
import { findLinks, buildQuote, canQuote, downloadSpoilers } from './quote.js';
import { mountApi } from './api.js';
import { getSettings } from './settings.js';

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

    client.on(Events.MessageCreate, async (message) => {
      try {
        if (!message.guildId || message.author.bot || message.webhookId || !message.content) return;
        if (!getSettings(message.guildId).enabled) return;
        const links = findLinks(message.content).filter((l) => l.guildId === message.guildId); // 他のサーバーのリンクは対象外
        if (!links.length) return;
        const now = Date.now();
        if (now - (lastByUser.get(message.author.id) ?? 0) < USER_COOLDOWN) return;
        lastByUser.set(message.author.id, now);
        for (const [k, t] of lastByLink) if (now - t > LINK_COOLDOWN) lastByLink.delete(k);

        const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
        const embeds = [], rows = [], files = [];
        for (const l of links) {
          const key = `${message.channelId}:${l.messageId}`;
          if (lastByLink.has(key)) continue;
          const source = message.guild.channels.cache.get(l.channelId) ?? await message.guild.channels.fetch(l.channelId).catch(() => null);
          if (!source?.messages || !await canQuote({ source, dest: message.channel, member, me: message.guild.members.me })) continue;
          const original = await source.messages.fetch(l.messageId).catch(() => null);
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
