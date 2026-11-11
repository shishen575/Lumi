import { getRules, getStats, metricValue } from './db.js';

/** 1人分のロールを評価して付与/剥奪する。変更があった数を返す */
export async function evaluateMember(member, rules = getRules(member.guild.id)) {
  if (!rules.length || member.user.bot) return 0;
  const stats = getStats(member.guild.id, member.id);
  const me = member.guild.members.me;
  const add = new Set();
  const remove = new Set();

  const byMetric = Map.groupBy(rules, (r) => r.metric);
  for (const group of byMetric.values()) {
    const ok = group.filter((r) => metricValue(stats, r.metric) >= r.threshold);
    for (const r of ok) {
      // より高い段階で「下位ロールを置き換え」が有効なら、このロールは外す
      const superseded = ok.some((h) => h.threshold > r.threshold && h.replace_lower);
      if (superseded) remove.add(r.role_id);
      else add.add(r.role_id);
    }
  }
  // 同じロールが複数ルールに出る場合は付与を優先
  for (const id of add) remove.delete(id);

  const usable = (id) => {
    const role = member.guild.roles.cache.get(id);
    return role && !role.managed && me && me.permissions.has('ManageRoles') && role.position < me.roles.highest.position;
  };
  const toAdd = [...add].filter((id) => !member.roles.cache.has(id) && usable(id));
  const toRemove = [...remove].filter((id) => member.roles.cache.has(id) && usable(id));
  try {
    if (toAdd.length) await member.roles.add(toAdd, 'Activity role');
    if (toRemove.length) await member.roles.remove(toRemove, 'Activity role (replaced by higher tier)');
  } catch (e) {
    console.error(`[roles] ${member.guild.name}/${member.id}:`, e.message);
    return 0;
  }
  return toAdd.length + toRemove.length;
}

export async function evaluateUser(guild, userId) {
  const rules = getRules(guild.id);
  if (!rules.length) return;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  if (member) await evaluateMember(member, rules);
}

/** サーバー全員を再評価(既存の統計に新ルールを適用したい時用) */
export async function evaluateGuild(guild) {
  const rules = getRules(guild.id);
  const members = await guild.members.fetch();
  let changed = 0;
  for (const m of members.values()) changed += await evaluateMember(m, rules);
  return changed;
}
