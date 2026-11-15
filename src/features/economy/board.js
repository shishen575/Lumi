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
        if (ch.lastMessageId === old.id) { await old.edit(payload); setKV(g, key, { ...st, at: now, sticky: replace }); return true; } // まだ一番下: そのまま書き換える
        await old.delete().catch(() => {}); // 上に流れた: 消して、下に出し直す
      }
    }
    const m = await ch.send({ ...payload, allowedMentions: { parse: [] } });
    setKV(g, key, { ch: ch.id, msg: m.id, at: now, sticky: !!replace }); return true;
  } catch (e) { console.warn(`[board:${kind}] 送れませんでした (${g}): ${e.message}`); return false; }
}
/** 前回から minutes 分たっていれば true(まだなら false) */
/** 「最終更新」の表示(Discordの時刻表示: 見る人の時計で、時刻と、「○分前」が出る) */
export const updatedLine = (now = Date.now()) => `🕒 最終更新 <t:${Math.floor(now / 1000)}:t>(<t:${Math.floor(now / 1000)}:R>)`;
export const boardDue = (g, kind, minutes, now = Date.now()) => { const at = getKV(g, `board:${kind}`, {}).at; return !at || now - at >= minutes * 60_000 - 5_000; };

/**
 * ボードのチャンネルで、誰かが話したら、少し待ってから、ボードを一番下に出し直す(いつも一番下に見えるように)。
 * 話し続けている間は、8秒静かになるまで待つ。ただし、30秒以上たったら、出し直す。出し直す関数は、種類ごとに渡す
 */
const pending = new Map();
/**
 * repost: { 名前: 出し直す関数 } または { 名前: { channel: (g) => ({ ch, msg }) | null, run: (g) => Promise } }。
 * 関数だけを渡したときは、board:名前 の状態(チャンネルと最後のメッセージ)を見る。channel が null を返す種類は、何もしない
 */
export function stickBoards(client, repost) {
  const specs = Object.entries(repost).map(([kind, spec]) => [kind, typeof spec === 'function'
    ? { channel: (g) => getKV(g, `board:${kind}`, {}), run: spec } : spec]);
  return (msg) => {
    if (!msg.guildId) return;
    // 自分(Bot)のメッセージは、ボード自身なので無視する。ただし、コマンドの返事(スラッシュコマンドやボタンへの返信)は、数える(返事のあとに、ボードが下へ戻る)
    if (msg.author?.id === client.user?.id && !msg.interactionMetadata && !msg.interaction) return;
    for (const [kind, { channel, run }] of specs) {
      const st = channel(msg.guildId); if (!st?.ch || st.ch !== msg.channelId || st.msg === msg.id) continue; // 「一番下に出す」がオフなら、channel が null を返すか、出し直す側が、何もしない
      const key = `${msg.guildId}:${kind}`, now = Date.now(), cur = pending.get(key) ?? { first: now };
      clearTimeout(cur.t);
      cur.t = setTimeout(() => { pending.delete(key); run(msg.guildId).catch((e) => console.warn(`[board:${kind}] 出し直せませんでした:`, e.message)); }, Math.min(8000, Math.max(1000, 30000 - (now - cur.first))));
      cur.t.unref?.(); pending.set(key, cur);
    }
  };
}
