import { Events } from 'discord.js';
import { addStat, getSettings, setLeft, reconcileMembers } from './db.js';
import { evaluateUser } from './roles.js';
import { mountApi } from './api.js';
import { noteLive, markInterrupted } from './backfill.js';
import { rankCommand, topCommand } from './commands.js';

export default {
  name: 'activity-roles',
  title: '活動ロール',
  ui: '/dashboard/features/activity-roles.js', // ダッシュボードのタブ
  help: [
    'サーバーでの活動に応じて、ロールが自動で付与されます。',
    '・**発言数** … メッセージを送るたびにカウント(連投は一定時間カウントされません)',
    '・**リアクション** … 自分の投稿に付いた数 / 自分が付けた数(自分への反応は除く)',
    '・**VC時間** … ボイスチャンネルに接続している時間(AFK・スピーカーミュート中は除く)',
    '`/rank` で、自分の数・順位・ランク・次のランクまでの必要数を確認できます。',
    '`/top` で、ランキングを10位ごとに見られます(ボタンでページ送り)。',
  ].join('\n'),
  commands: [rankCommand, topCommand], // スラッシュコマンド(/rank /top)

  register({ client, router }) {
    mountApi(router, client);
    markInterrupted();

    // 退出したメンバーはランキングから除外(再参加で復活)。停止中の出入りは起動時に合わせ直す
    client.on(Events.GuildMemberRemove, (m) => setLeft(m.guild.id, m.id, true));
    client.on(Events.GuildMemberAdd, (m) => setLeft(m.guild.id, m.id, false));
    client.once(Events.ClientReady, async () => {
      for (const g of client.guilds.cache.values()) {
        try { reconcileMembers(g.id, (await g.members.fetch()).keys()); }
        catch (e) { console.error(`[activity-roles] メンバー同期に失敗 ${g.name}:`, e.message); }
      }
    });

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
