import { getRules, getStats, metricValue, reconcileMembers } from './db.js';
import { notifyGranted } from './notify.js';

/** 1人分のロールを評価して付与/剥奪する。変更があった数を返す */
// 同じメンバーの評価は順番に1つずつ実行する(同時実行による二重付与・二重通知の防止)
const chains = new Map();
export function evaluateMember(member, rules = getRules(member.guild.id), opts = {}) {
  const key = `${member.guild.id}:${member.id}`;
  const p = (chains.get(key) ?? Promise.resolve()).then(() => evaluateOne(member, rules, opts));
  chains.set(key, p);
  p.finally(() => { if (chains.get(key) === p) chains.delete(key); }).catch(() => {});
  return p;
}

async function evaluateOne(member, rules, { notify = true } = {}) {
  if (!rules.length || member.user.bot) return 0;
  const stats = getStats(member.guild.id, member.id);
  const me = member.guild.members.me;
  const add = new Set();
  const remove = new Set();

  const byMetric = Map.groupBy(rules, (r) => r.metric);
  for (const group of byMetric.values()) {
    const ok = group.filter((r) => metricValue(stats, r.metric) >= r.threshold);
    // 「条件を下回ったら剥奪」のルール: 条件未満の人が持っていれば外す
    for (const r of group) if (r.revoke && metricValue(stats, r.metric) < r.threshold) remove.add(r.role_id);
    for (const r of ok) {
      // より高い段階で「下位ロールを置き換え」が有効なら、このロールは外す
      const superseded = ok.some((h) => h.threshold > r.threshold && h.replace_lower);
      if (superseded) remove.add(r.role_id);
      else add.add(r.role_id);
    }
  }
  // 同じロールが別のルールで条件を満たしている場合は、付与(維持)を優先
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
  if (notify && toAdd.length) await notifyGranted(member, toAdd, rules, stats, metricValue);
  return toAdd.length + toRemove.length;
}

export async function evaluateUser(guild, userId) {
  const rules = getRules(guild.id);
  if (!rules.length) return;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  if (member) await evaluateMember(member, rules);
}

/** サーバー全員を再評価(既存の統計に新ルールを適用したい時用) */
export async function evaluateGuild(guild, { notify = false } = {}) {
  const rules = getRules(guild.id);
  const members = await guild.members.fetch();
  reconcileMembers(guild.id, members.keys()); // ついでに退出フラグを実態に合わせる
  let changed = 0;
  for (const m of members.values()) changed += await evaluateMember(m, rules, { notify }); // 既定は通知しない(スパム防止)。ダッシュボードで選んだときだけ通知
  return changed;
}
