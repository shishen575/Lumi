import { bump, rulesForChannel, isGranted, markGranted } from './db.js';

const usable = (guild, id) => {
  const role = guild.roles.cache.get(id), me = guild.members.me;
  return !!role && !role.managed && !!me && me.permissions.has('ManageRoles') && role.position < me.roles.highest.position;
};

/** メッセージの属するチャンネル(スレッドは、親チャンネル扱いにできる) */
function channelKeys(msg) {
  const ch = msg.channel;
  return ch?.isThread?.() ? { id: ch.parentId, thread: true } : { id: msg.channelId, thread: false };
}

/**
 * 特定のチャンネルで発言した人に、ロールを付ける。
 * 1つのルールにつき、1人に1回だけ付ける(管理者が外したロールは、勝手に付け直さない)。
 * 付けたロールの数を返す
 */
export async function handleMessage(msg) {
  if (!msg.guildId || msg.author?.bot || msg.webhookId) return 0;
  const { id, thread } = channelKeys(msg);
  if (!id) return 0;
  const rules = rulesForChannel(msg.guildId, id).filter((r) => !thread || r.include_threads);
  if (!rules.length) return 0;
  const count = bump(msg.guildId, msg.author.id, id);
  const todo = rules.filter((r) => count >= r.min_messages && !isGranted(r.id, msg.author.id));
  if (!todo.length) return 0;
  const member = msg.member ?? await msg.guild.members.fetch(msg.author.id).catch(() => null);
  if (!member) return 0;
  let given = 0;
  for (const r of todo) {
    if (member.roles.cache.has(r.role_id)) { markGranted(r.id, member.id); continue; }
    if (!usable(msg.guild, r.role_id)) continue; // 付けられないときは、印を付けない(あとで直せば、次の発言で付く)
    try { await member.roles.add(r.role_id, `チャンネルロール(#${msg.channel.name ?? id} での発言)`); markGranted(r.id, member.id); given++; }
    catch (e) { console.error(`[channel-roles] ${msg.guild.name}/${member.id}:`, e.message); }
  }
  return given;
}
