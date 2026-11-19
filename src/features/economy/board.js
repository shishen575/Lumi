import { chanOf } from '../../core/channels.js';
import { getKV, setKV } from '../../core/db.js';

/**
 * チャンネルに出す「ボード」(株価のグラフ・値段表など)を、いつも一番下に出す。
 * replace が true: 前のメッセージが、まだ一番下にあれば、書き換える。上に流れていたら、消して、新しく一番下に出す(チャンネルに、最新の1つだけが残る)
 * replace が false: 毎回、新しく出す(前のものは、残る)
 * 状態は、サーバーごとに KV の board:<kind> に、チャンネルと最後のメッセージ・時刻を保存する
 */
export async function postBoard(client, g, kind, channelId, payload, { replace = true, now = Date.now() } = {}) {
  const ch = (await chanOf(client, channelId)); if (!ch?.isTextBased?.() || ch.guildId !== g) return false;
  const key = `board:${kind}`, st = getKV(g, key, {});
  try {
    if (replace && st.msg && st.ch === ch.id) {
      if (ch.lastMessageId === st.msg) { // まだ一番下: そのまま書き換える(書き換えられなければ、消して、出し直す)
        try { await ch.messages.edit(st.msg, payload); setKV(g, key, { ...st, at: now, sticky: replace }); return true; } catch { /* もう無い */ }
      }
      await ch.messages.delete(st.msg).catch(() => {}); // 上に流れた: 消して、下に出し直す(履歴を読む権限が無くても、消せる)
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
 * チャンネルの「一番下に出す」ものを、まとめて見張る(値段表・株価グラフ・パネル)。
 * items: [{ kind, prio, state: (g) => ({ ch, msg }) | null, run: (g) => Promise }]
 *   prio が大きいものほど、下(一番下に近い方)に出す。state が null を返すもの(一番下に出す、がオフ)は、対象にしない。
 * チャンネルで、だれかが話したり、コマンド・ボタンの返事が出たり、ほかの機能がメッセージを出したりしたら、静かになってから(8秒。続いていても30秒まで)、
 *   prio の小さい順に、run を呼ぶ(各 run は、自分が一番下になければ、前のものを消して、出し直す)。最後の prio が大きいものが、一番下に来る。
 * 出し直している間と、その直後の数秒は、自分たちが出したメッセージに反応しない(ずっと出し直し続けないように)
 */
const pending = new Map(), settling = new Map();
export function stickChannels(client, itemsOrFn) {
  const itemsFor = typeof itemsOrFn === 'function' ? itemsOrFn : () => itemsOrFn; // サーバーごとに、対象が変わるなら、関数(g) => [...]
  return (msg) => {
    if (!msg.guildId) return;
    const g = msg.guildId, chKey = `${g}:${msg.channelId}`;
    // Bot自身のメッセージは、ボード・パネル自身(か、ほかの自動の投稿)。出し直している最中と、その直後は、無視する。ただし、コマンド・ボタンへの返事は、いつも数える
    const own = msg.author?.id === client.user?.id && !msg.interactionMetadata && !msg.interaction;
    if (own && (settling.get(chKey) ?? 0) > Date.now()) return;
    const here = itemsFor(g).filter((it) => { const st = it.state(g); return st?.ch === msg.channelId && st.msg !== msg.id; });
    if (!here.length) return;
    const quiet = Math.max(8000, ...here.map((it) => it.delay?.(g) ?? 0)); // 静かになってから、出し直すまでの待ち(既定8秒。ギミックつきのバイトのパネルは、設定の秒数)
    const now = Date.now(), cur = pending.get(chKey) ?? { first: now };
    clearTimeout(cur.t);
    cur.t = setTimeout(async () => {
      pending.delete(chKey);
      const list = itemsFor(g).filter((it) => it.state(g)?.ch === msg.channelId).sort((a, b) => a.prio - b.prio);
      const top = list.at(-1), ch = (await chanOf(client, msg.channelId));
      if (!top || !ch || ch.lastMessageId === top.state(g)?.msg) return; // いちばん下に、すでにある
      settling.set(chKey, Infinity);
      try { for (const it of list) await it.run(g).catch((e) => console.warn(`[sticky:${it.kind}] 出し直せませんでした:`, e.message)); }
      finally { settling.set(chKey, Date.now() + 6000); }
    }, Math.min(quiet, Math.max(1000, Math.max(30000, quiet * 3) - (now - cur.first))));
    cur.t.unref?.(); pending.set(chKey, cur);
  };
}
