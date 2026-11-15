import { getKV, setKV } from '../../core/db.js';

/**
 * チャンネルに出す「ボード」(株価のグラフ・値段表など)を、いつも一番下に出す。
 * replace が true: 前のメッセージが、まだ一番下にあれば、書き換える。上に流れていたら、消して、新しく一番下に出す(チャンネルに、最新の1つだけが残る)
 * replace が false: 毎回、新しく出す(前のものは、残る)
 * 状態は、サーバーごとに KV の board:<kind> に、チャンネルと最後のメッセージ・時刻を保存する
 */
export async function postBoard(client, g, kind, channelId, payload, { replace = true, now = Date.now() } = {}) {
  const ch = client.channels.cache.get(channelId); if (!ch?.isTextBased?.() || ch.guildId !== g) return false;
  const key = `board:${kind}`, st = getKV(g, key, {});
  try {
    if (replace && st.msg && st.ch === ch.id) {
      let old = null; try { old = await ch.messages.fetch(st.msg); } catch { /* もう無い */ }
      if (old) {
        if (ch.lastMessageId === old.id) { await old.edit(payload); setKV(g, key, { ...st, at: now }); return true; } // まだ一番下: そのまま書き換える
        await old.delete().catch(() => {}); // 上に流れた: 消して、下に出し直す
      }
    }
    const m = await ch.send({ ...payload, allowedMentions: { parse: [] } });
    setKV(g, key, { ch: ch.id, msg: m.id, at: now }); return true;
  } catch (e) { console.warn(`[board:${kind}] 送れませんでした (${g}): ${e.message}`); return false; }
}
/** 前回から minutes 分たっていれば true(まだなら false) */
export const boardDue = (g, kind, minutes, now = Date.now()) => { const at = getKV(g, `board:${kind}`, {}).at; return !at || now - at >= minutes * 60_000 - 5_000; };
