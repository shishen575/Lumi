import { chanOf } from './channels.js';

/**
 * 連携の「お知らせ」の宛先を決めて、送る。
 *  1. route(地域キー)があり、管理者が `channel_<route>` を選んでいれば、そのチャンネル。なければ、通常の通知先
 *  2. `thread_by_pref` がオンで、thread(都道府県名など)があれば、選ばれたチャンネルの中で、同じ名前のスレッドを探して投稿する。
 *     なければ、公開スレッドを作る(フォーラムなら、その名前の投稿を作る)
 *  3. スレッドが作れない・見つからないときは、スレッドなしで、チャンネルに送る(通知を落とさない)
 * 宛先は、いつも、管理者が選んだチャンネルの中だけ。リクエストの文字列から、チャンネルIDは作らない
 */
export const ROUTES = ['hokkaido_tohoku', 'kanto', 'chubu', 'kinki', 'chugoku_shikoku', 'kyushu_okinawa'];
const FORUM = 15, MEDIA = 16;
const isId = (s) => /^\d{15,25}$/.test(String(s ?? ''));
/** スレッド名に使えるように直す: 改行・メンション・記号を取り除き、100文字まで */
export const cleanThreadName = (v) => String(v ?? '').replace(/<[@#&!][^>]*>/g, '').replace(/[\r\n\t@`*_~|<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const locks = new Map();
const serial = (key, fn) => { const p = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn); locks.set(key, p); p.finally(() => { if (locks.get(key) === p) locks.delete(key); }).catch(() => {}); return p; }; // 同じ名前のスレッドを、同時に2つ作らない

export async function deliver(client, ctx, { embed, route, thread }) {
  const values = ctx.it?.config?.values ?? {}, mode = ['region', 'single', 'both'].includes(values.routeMode) ? values.routeMode : 'region';
  const routed = mode !== 'single' && ROUTES.includes(route) && isId(values[`channel_${route}`]) ? values[`channel_${route}`] : null;
  // 宛先: 地域ごと(未選択なら、通常)/ 全部まとめる / 両方
  const dests = mode === 'both' && routed ? [...new Set([routed, ctx.channelId])] : [routed ?? ctx.channelId];
  const results = [], done = new Set(); // 送り済みのチャンネル(消えたチャンネルの代わりに、通常の先へ送るとき、二重に送らない)
  for (const id of dests) {
    try { results.push({ ...(await sendOne(client, ctx, values, { embed, thread, id, routed: id === routed, done })), ok: true }); }
    catch (e) { console.warn(`[internal] 宛先に送れませんでした: ${e.message}`); results.push({ ok: false }); }
  }
  const okOnes = results.filter((r) => r.ok);
  if (!okOnes.length) throw new Error('channel not available');
  return { thread: okOnes.some((r) => r.thread), created: okOnes.some((r) => r.created), routed: !!routed, mode, sent: okOnes.filter((r) => !r.dup).length };
}

async function sendOne(client, ctx, values, { embed, thread, id, routed, done }) {
  const noMention = { parse: [] }, name = cleanThreadName(thread);
  const find = async (id) => { const c = await chanOf(client, id); return c && c.guildId === ctx.guildId ? c : null; };
  let ch = await find(id);
  if (!ch && routed) ch = await find(ctx.channelId); // 選ばれたチャンネルが、もう無い: 通常の通知先へ
  if (!ch) throw new Error('channel not available');
  if (done.has(ch.id)) return { thread: false, dup: true };
  done.add(ch.id);

  const sendTo = (c) => c.send({ embeds: [embed], allowedMentions: noMention });
  if (values.thread_by_pref && name && !ch.isThread?.() && ch.threads) {
    try {
      const out = await serial(`${ch.id}:${name}`, async () => {
        let th = ch.threads.cache.find((t) => t.name === name && !t.archived);
        if (!th) { const a = await ch.threads.fetchActive().catch(() => null); th = a?.threads?.find((t) => t.name === name) ?? null; }
        if (!th) { const a = await ch.threads.fetchArchived({ limit: 100 }).catch(() => null); th = a?.threads?.find((t) => t.name === name) ?? null; } // アーカイブ済みなら、送ると、開き直る
        if (th) { await sendTo(th); return 'sent'; }
        if (ch.type === FORUM || ch.type === MEDIA) { await ch.threads.create({ name, message: { embeds: [embed], allowedMentions: noMention }, reason: '連携のお知らせ' }); return 'created'; }
        const made = await ch.threads.create({ name, autoArchiveDuration: 10080, reason: '連携のお知らせ' });
        await sendTo(made); return 'created';
      });
      return { thread: true, created: out === 'created' };
    } catch (e) { console.warn(`[internal] スレッドに送れませんでした(${name}): ${e.message}。スレッドなしで送ります`); }
  }
  if (ch.type === FORUM || ch.type === MEDIA) { // フォーラムには、直接、送れない: 通常の通知先へ
    const alt = ctx.channelId !== ch.id ? await find(ctx.channelId) : null;
    if (!alt?.send) throw new Error('forum needs a thread');
    ch = alt;
  }
  await sendTo(ch);
  return { thread: false };
}
