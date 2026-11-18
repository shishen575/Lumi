/** チャンネル(スレッドも)を取る。キャッシュになければ、取りにいく(アーカイブされたスレッドや、まだ見ていないスレッドのため) */
export async function chanOf(client, id) {
  if (!/^\d{15,25}$/.test(String(id ?? ''))) return null;
  return client.channels.cache.get(id) ?? (await client.channels.fetch(id).catch(() => null));
}
/** ダッシュボードの選択肢にしてよいか: 文字のチャンネル、または、スレッド */
export const isPostable = (c) => !!c?.isTextBased?.() && !c.isVoiceBased?.();
