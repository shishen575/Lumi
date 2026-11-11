import { Events } from 'discord.js';
import { addStat, getSettings } from './db.js';
import { evaluateUser } from './roles.js';
import { mountApi } from './api.js';
import { noteLive, markInterrupted } from './backfill.js';

export default {
  name: 'activity-roles',
  title: '活動ロール',
  ui: '/features/activity-roles.js', // ダッシュボードのタブ

  register({ client, router }) {
    mountApi(router, client);
    markInterrupted();

    const lastMsg = new Map();
    client.on(Events.MessageCreate, async (msg) => {
      if (!msg.guildId || msg.author.bot || msg.webhookId) return;
      const key = `${msg.guildId}:${msg.author.id}`;
      const cd = getSettings(msg.guildId).message_cooldown * 1000;
      const now = Date.now();
      if (cd && now - (lastMsg.get(key) ?? 0) < cd) return; // 連投の水増し防止
      lastMsg.set(key, now);
      addStat(msg.guildId, msg.author.id, 'messages');
      noteLive(msg.guildId, msg.author.id);
      await evaluateUser(msg.guild, msg.author.id);
    });

    async function onReaction(reaction, user, delta) {
      try {
        if (user.bot) return;
        if (reaction.partial) reaction = await reaction.fetch();
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
        const guild = message.guild;
        if (!guild) return;
        addStat(guild.id, user.id, 'reactions_given', delta);
        await evaluateUser(guild, user.id);
        const author = message.author;
        if (author && !author.bot && author.id !== user.id) { // 自演は除外
          addStat(guild.id, author.id, 'reactions_received', delta);
          await evaluateUser(guild, author.id);
        }
      } catch (e) { console.error('[activity-roles:reaction]', e.message); }
    }
    client.on(Events.MessageReactionAdd, (r, u) => onReaction(r, u, 1));
    client.on(Events.MessageReactionRemove, (r, u) => onReaction(r, u, -1));

    // VC: 1分ごとにVC内の人へ60秒加算(再起動に強い)
    setInterval(async () => {
      for (const guild of client.guilds.cache.values()) {
        const { voice_require_others } = getSettings(guild.id);
        for (const ch of guild.channels.cache.values()) {
          if (!ch.isVoiceBased() || ch.id === guild.afkChannelId) continue;
          const humans = ch.members.filter((m) => !m.user.bot);
          if (voice_require_others && humans.size < 2) continue;
          for (const m of humans.values()) {
            if (m.voice.selfDeaf || m.voice.deaf) continue; // スピーカーミュート放置は除外
            addStat(guild.id, m.id, 'voice_seconds', 60);
            await evaluateUser(guild, m.id);
          }
        }
      }
    }, 60_000);
  },
};
