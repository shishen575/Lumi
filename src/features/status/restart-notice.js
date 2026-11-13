import { Events, EmbedBuilder } from 'discord.js';
import { loadNotes, unseen, latestN, fieldFor } from '../../core/release-notes.js';
import { getKV, setKV } from '../../core/db.js';
import { onShutdown } from '../../core/shutdown.js';
import { version } from '../../core/version.js';

const KEY = 'restart_notice';
/** 再起動のお知らせの設定: { channel_id: string|null } */
export const getNotice = (g) => ({ channel_id: getKV(g, KEY, {}).channel_id || null });
export const setNotice = (g, channel_id) => setKV(g, KEY, { channel_id: channel_id || null });
const STATE = 'restart_state'; // { shutdownAt, lastStartAt }

async function post(client, g, content, embeds = []) {
  const id = getNotice(g).channel_id; if (!id) return false;
  const ch = client.channels.cache.get(id);
  if (!ch?.isTextBased?.() || ch.guildId !== g) return false;
  try { await ch.send({ content, ...(embeds.length ? { embeds } : {}), allowedMentions: { parse: [] } }); return true; }
  catch (e) { console.warn(`[restart-notice] ${g} に送れませんでした: ${e.message}`); return false; }
}
const guilds = (client) => [...client.guilds.cache.keys()].filter((g) => getNotice(g).channel_id);

/** 停止・再起動の直前に、お知らせを出す。起動したときに、戻ってきたことを出す */
export function setupRestartNotice(client) {
  onShutdown(async ({ reason, code, waitMs }) => {
    const update = code === 42;
    const text = update ? `🔄 更新のため、Lumi を再起動します。まもなく戻ります。` : `🔄 Lumi を停止・再起動します。まもなく戻ります。`;
    await Promise.allSettled(guilds(client).map(async (g) => {
      if (await post(client, g, text)) setKV(g, STATE, { ...getKV(g, STATE, {}), shutdownAt: Date.now(), update });
    }));
  });
  client.once(Events.ClientReady, async () => {
    const now = Date.now(), v = version ? `(バージョン \`${version}\`)` : '';
    const notes = loadNotes();
    await Promise.allSettled(guilds(client).map(async (g) => {
      const st = getKV(g, STATE, {});
      if (st.lastStartAt && now - st.lastStartAt < 60_000) return; // 起動を繰り返しているときは、流さない
      const back = st.shutdownAt && now - st.shutdownAt < 15 * 60_000;
      const text = back ? `✅ Lumi が戻りました${v}。再起動にかかった時間: ${Math.max(1, Math.round((now - st.shutdownAt) / 1000))}秒` : `✅ Lumi が起動しました${v}。`;
      // 追加の機能などのリリースノート: まだ知らせていない分だけ(普通の再起動では、出ない)
      const fresh = unseen(notes, st.lastRelease ?? null);
      const embeds = fresh.length ? [new EmbedBuilder().setColor(0x6d5dfc).setTitle('📝 アップデート内容')
        .addFields(fresh.map(fieldFor)).setFooter({ text: '詳しくは、公式サイトの「更新履歴」をどうぞ' })] : [];
      const sent = await post(client, g, text, embeds);
      setKV(g, STATE, { lastStartAt: now, ...(sent && fresh.length ? { lastRelease: latestN(notes) } : { lastRelease: st.lastRelease }) });
    }));
  });
}
