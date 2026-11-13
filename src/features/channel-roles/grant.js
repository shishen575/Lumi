import { bump, rulesForTargets, isGranted, markGranted } from './db.js';

const usable = (guild, id) => {
  const role = guild.roles.cache.get(id), me = guild.members.me;
  return !!role && !role.managed && !!me && me.permissions.has('ManageRoles') && role.position < me.roles.highest.position;
};

/** メッセージの場所: チャンネルID(スレッドは親チャンネル)と、そのカテゴリID */
function whereIs(msg) {
  const ch = msg.channel;
  if (ch?.isThread?.()) return { channel: ch.parentId, category: ch.parent?.parentId ?? null, thread: true };
  return { channel: msg.channelId, category: ch?.parentId ?? null, thread: false };
}

/**
 * 特定のチャンネル(またはカテゴリ)で発言した人に、ロールを付ける。
 * カテゴリのルールは、そのカテゴリの中のどのチャンネルでの発言も数える(回数は、カテゴリ全体の合計)。
 * 「何回でも付与」がオフのルールは、1つのルールにつき1人に1回だけ付ける(管理者が外したロールは、付け直さない)。
 * オンのルールは、条件を満たしていて、ロールを持っていなければ、発言のたびに付ける。
 * 付けたロールの数を返す
 */
export async function handleMessage(msg) {
  if (!msg.guildId || msg.author?.bot || msg.webhookId) return 0;
  const w = whereIs(msg);
  if (!w.channel) return 0;
  const rules = rulesForTargets(msg.guildId, [w.channel, w.category]).filter((r) => !w.thread || r.include_threads);
  if (!rules.length) return 0;
  const counts = new Map(); // 対象ごとに、1回だけ数える(チャンネルのルールとカテゴリのルールが重なっても、二重に数えない)
  for (const key of new Set(rules.map((r) => r.channel_id))) counts.set(key, bump(msg.guildId, msg.author.id, key));
  const todo = rules.filter((r) => counts.get(r.channel_id) >= r.min_messages && (r.repeat || !isGranted(r.id, msg.author.id)));
  if (!todo.length) return 0;
  const member = msg.member ?? await msg.guild.members.fetch(msg.author.id).catch(() => null);
  if (!member) return 0;
  let given = 0;
  for (const r of todo) {
    if (member.roles.cache.has(r.role_id)) { if (!r.repeat) markGranted(r.id, member.id); continue; }
    if (!usable(msg.guild, r.role_id)) continue; // 付けられないときは、印を付けない(あとで直せば、次の発言で付く)
    try {
      await member.roles.add(r.role_id, `チャンネルロール(#${msg.channel.name ?? w.channel} での発言)`);
      if (!r.repeat) markGranted(r.id, member.id);
      given++;
    } catch (e) { console.error(`[channel-roles] ${msg.guild.name}/${member.id}:`, e.message); }
  }
  return given;
}
