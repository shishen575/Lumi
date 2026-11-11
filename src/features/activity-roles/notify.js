import { METRICS, getSettings } from './db.js';

export const DEFAULT_TEMPLATE = '🎉 {user} さんが **{role}** を獲得しました!({condition})';

const render = (tpl, v) => tpl.replace(/\{(user|name|role|condition)\}/g, (_, k) => v[k]);

async function send(guild, channelId, content, userId) {
  const ch = channelId && guild.channels.cache.get(channelId);
  if (!ch?.isTextBased()) return false;
  await ch.send({ content: content.slice(0, 2000), allowedMentions: { users: [userId] } }); // ロール/everyoneは絶対にメンションしない
  return true;
}

/** ロールが付与されたとき、通知チャンネルが設定されていれば通知する(失敗してもロール付与には影響しない) */
export async function notifyGranted(member, roleIds, rules, stats, metricValue) {
  const { notify_channel_id, notify_template } = getSettings(member.guild.id);
  if (!notify_channel_id) return;
  const lines = roleIds.map((roleId) => {
    const role = member.guild.roles.cache.get(roleId);
    const rule = rules.filter((r) => r.role_id === roleId && metricValue(stats, r.metric) >= r.threshold)
      .sort((a, b) => b.threshold - a.threshold)[0];
    return render(notify_template || DEFAULT_TEMPLATE, {
      user: `<@${member.id}>`, name: member.displayName, role: role?.name ?? '不明なロール',
      condition: rule ? `${METRICS[rule.metric]} ${rule.threshold}以上` : '',
    });
  });
  try { await send(member.guild, notify_channel_id, lines.join('\n'), member.id); }
  catch (e) { console.error(`[notify] ${member.guild.name}:`, e.message); }
}

/** ダッシュボードの「テスト送信」用 */
export async function sendTest(guild, member) {
  const { notify_channel_id, notify_template } = getSettings(guild.id);
  const text = render(notify_template || DEFAULT_TEMPLATE, {
    user: `<@${member.id}>`, name: member.displayName, role: 'サンプルロール', condition: `${METRICS.messages} 100以上`,
  });
  return send(guild, notify_channel_id, `(テスト) ${text}`, member.id);
}
