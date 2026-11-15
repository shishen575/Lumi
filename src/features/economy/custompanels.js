import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { getKV, setKV } from '../../core/db.js';
import { commandCatalog, findCommand, registerHiddenCommands, resyncGuildCommands } from '../../core/commands.js';
import { asCommand } from './panels.js';

/**
 * カスタムパネル: どんなコマンドでも、ボタンにして、チャンネルに置ける。
 * ボタン1つ = コマンド(+ サブコマンド)+ 項目の値。値は「決めない(省略)」「固定の値」「押したときに入力」から選ぶ(入力は、入力欄で聞く)。
 * 使える項目は、文字・整数・小数・オン/オフ。ユーザー・チャンネル・ロール・ファイルの項目は、ボタンでは指定できない(任意なら、省略される)
 */
const KEY = 'custompanels';
export const MAX_CUSTOM = 10, MAX_BUTTONS = 25;
const SUPPORTED = new Set([3, 4, 5, 10]); // 文字・整数・オン/オフ・小数
const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const clean = (x, n) => String(x ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, n);
export const customPanels = (g) => getKV(g, KEY, {});
const save = (g, all) => setKV(g, KEY, all);

/** コマンドの JSON と、サブコマンド名から、項目の一覧を返す。使えないときは、error */
export function schemaOf(cmd, sub) {
  const opts = cmd.options ?? [], subs = opts.filter((o) => o.type === 1);
  if (opts.some((o) => o.type === 2)) return { error: `/${cmd.name} は、サブコマンドのグループがあるので、ボタンにできません` };
  if (subs.length) {
    if (!sub) return { error: `/${cmd.name} は、サブコマンドを選んでください` };
    const sc = subs.find((x) => x.name === sub); if (!sc) return { error: `/${cmd.name} に、${sub} は、ありません` };
    return { options: sc.options ?? [] };
  }
  return { options: opts };
}
/** 項目の値を、型に合わせて直す(固定の値・入力欄の値の両方)。{ v } か { error } */
export function parseValue(o, raw) {
  const label = o.name;
  if (o.type === 5) return { v: ['true', '1', 'on', 'yes', 'はい', 'オン'].includes(String(raw).normalize('NFKC').trim().toLowerCase()) || raw === true };
  if (o.type === 3) {
    const t = String(raw ?? '').trim(); if (!t) return { error: `${label}: 入力してください` };
    if (o.choices?.length) { const c = o.choices.find((x) => x.value === t || x.name === t); return c ? { v: c.value } : { error: `${label}: ${o.choices.map((x) => x.name).join(' / ')} のどれかを入れてください` }; }
    if (o.max_length && t.length > o.max_length) return { error: `${label}: ${o.max_length}文字までです` };
    return { v: t };
  }
  const n = Number(String(raw ?? '').normalize('NFKC').replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || String(raw ?? '').trim() === '') return { error: `${label}: 数字で入れてください` };
  const v = o.type === 4 ? Math.floor(n) : n;
  if (o.choices?.length) { const c = o.choices.find((x) => x.value === v); return c ? { v } : { error: `${label}: ${o.choices.map((x) => `${x.name}(${x.value})`).join(' / ')} のどれかです` }; }
  if (o.min_value !== undefined && v < o.min_value) return { error: `${label}: ${o.min_value} 以上です` };
  if (o.max_value !== undefined && v > o.max_value) return { error: `${label}: ${o.max_value} 以下です` };
  return { v };
}

/** ボタン1つを、正しい形に直す。{ button } か { error } */
function sanitizeButton(raw, catalog) {
  const cmd = catalog.find((c) => c.name === raw?.command); if (!cmd) return { error: `コマンド ${raw?.command ?? ''} が、ありません` };
  const sc = schemaOf(cmd, raw.sub || null); if (sc.error) return { error: sc.error };
  const values = {}, ask = [];
  for (const o of sc.options) {
    if (!SUPPORTED.has(o.type)) { if (o.required) return { error: `/${cmd.name} の「${o.name}」は、ボタンでは指定できない種類なので、このコマンドは使えません` }; continue; }
    const mode = raw.modes?.[o.name] ?? (raw.ask?.includes(o.name) ? 'ask' : raw.values?.[o.name] !== undefined ? 'fixed' : 'skip');
    if (mode === 'fixed') { const r = parseValue(o, raw.values?.[o.name]); if (r.error) return { error: `${cmd.name} ${sub0(raw)}${r.error}` }; values[o.name] = r.v; }
    else if (mode === 'ask') ask.push(o.name);
    else if (o.required) return { error: `/${cmd.name} ${sub0(raw)}の「${o.name}」(必須)を、決めてください` };
  }
  if (ask.length > 5) return { error: '「押したときに入力」は、1つのボタンに5項目までです' };
  const label = clean(raw.label, 78) || `/${cmd.name}`;
  return { button: { label, emoji: [...clean(raw.emoji, 8)].slice(0, 2).join(''), style: STYLES[raw.style] ? raw.style : 'secondary', command: cmd.name, sub: raw.sub || '', values, ask } };
}
const sub0 = (raw) => (raw.sub ? `${raw.sub} ` : '');

export function sanitizePanel(raw, catalog) {
  const buttons = [];
  for (const b of (Array.isArray(raw?.buttons) ? raw.buttons : []).slice(0, MAX_BUTTONS)) { const r = sanitizeButton(b, catalog); if (r.error) return { error: r.error }; buttons.push(r.button); }
  if (!buttons.length) return { error: 'ボタンを、1つ以上、作ってください' };
  return { panel: { title: clean(raw?.title, 80) || 'パネル', description: clean(raw?.description, 1000), sticky: raw?.sticky !== false, hide: !!raw?.hide, buttons } };
}

export function customMessage(panel, id) {
  const rows = [];
  for (let n = 0; n < panel.buttons.length; n += 5) rows.push(new ActionRowBuilder().addComponents(panel.buttons.slice(n, n + 5).map((b, k) => {
    const x = new ButtonBuilder().setCustomId(`cpanel:${id}:${n + k}`).setStyle(STYLES[b.style] ?? ButtonStyle.Secondary);
    try { if (b.emoji) x.setEmoji(b.emoji); x.setLabel(b.label); } catch { x.setLabel(`${b.emoji} ${b.label}`.trim().slice(0, 78)); }
    return x;
  })));
  return { embeds: [new EmbedBuilder().setColor(0x6d5dfc).setTitle(panel.title).setDescription(panel.description || null)], components: rows };
}

// 廃止するコマンド(「廃止する」をオンにしたパネルで、使っているコマンド。/help は、いつも残す)
registerHiddenCommands((g) => {
  const out = {};
  for (const [id, p] of Object.entries(customPanels(g))) {
    if (!p.hide || !p.msg) continue;
    for (const b of p.buttons) if (b.command !== 'help') out[b.command] = `このサーバーでは、\`/${b.command}\` は廃止されました。パネル(https://discord.com/channels/${g}/${p.ch}/${p.msg})から使えます。`;
  }
  return out;
});

/** 置く・更新する(id が無ければ、新しく作る) */
export async function saveCustomPanel(client, g, id, raw, channelId) {
  const all = customPanels(g), existing = id ? all[id] : null;
  if (!existing && Object.keys(all).length >= MAX_CUSTOM) throw new Error(`カスタムパネルは、${MAX_CUSTOM}個までです`);
  const r = sanitizePanel(raw, commandCatalog()); if (r.error) throw new Error(r.error);
  const ch = client.channels.cache.get(channelId); if (!ch?.isTextBased?.() || ch.guildId !== g) throw new Error('チャンネルを選んでください');
  const pid = existing ? id : Math.random().toString(36).slice(2, 10), payload = customMessage(r.panel, pid);
  let msg = null;
  if (existing?.msg && existing.ch === ch.id) { try { msg = await ch.messages.edit(existing.msg, payload); } catch { /* 消されていたら、新しく置く */ } }
  if (!msg) {
    if (existing?.msg && existing.ch !== ch.id) await client.channels.cache.get(existing.ch)?.messages.delete(existing.msg).catch(() => {});
    msg = await ch.send({ ...payload, allowedMentions: { parse: [] } });
  }
  all[pid] = { ...r.panel, ch: ch.id, msg: msg.id, at: Date.now() }; save(g, all);
  await resyncGuildCommands(g);
  return { id: pid, ...all[pid] };
}
export async function removeCustomPanel(client, g, id) {
  const all = customPanels(g), p = all[id]; if (!p) return false;
  if (p.msg) await client.channels.cache.get(p.ch)?.messages.delete(p.msg).catch(() => {});
  delete all[id]; save(g, all); await resyncGuildCommands(g); return true;
}
/** 「一番下に出す」の対象(サーバーごと) */
export const customStickItems = (client, g) => Object.entries(customPanels(g)).map(([id, p]) => ({ kind: `custom:${id}`, prio: 200,
  state: (gg) => { const q = customPanels(gg)[id]; return q && q.sticky !== false && q.msg ? { ch: q.ch, msg: q.msg } : null; },
  run: async (gg) => {
    const all = customPanels(gg), q = all[id]; if (!q || q.sticky === false) return;
    const ch = client.channels.cache.get(q.ch); if (!ch?.isTextBased?.() || ch.lastMessageId === q.msg) return;
    await ch.messages.delete(q.msg).catch(() => {});
    const m = await ch.send({ ...customMessage(q, id), allowedMentions: { parse: [] } }); all[id] = { ...q, msg: m.id, at: Date.now() }; save(gg, all);
  } }));

/** ボタンと入力欄(モーダル)の処理: cpanel:<パネル>:<番号>[:m] */
export const customComponent = {
  id: 'cpanel',
  async execute(i) {
    const [, pid, idxS, isM] = i.customId.split(':'), say = (content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const p = customPanels(i.guildId)[pid], b = p?.buttons?.[Number(idxS)]; if (!b) return say('このボタンは、もう使えません。パネルが古くなっています(管理者が、置き直せます)。');
    const cmd = findCommand(b.command), json = commandCatalog().find((c) => c.name === b.command); if (!cmd || !json) return say(`/${b.command} は、もう使えません。`);
    const sc = schemaOf(json, b.sub || null); if (sc.error) return say(sc.error);
    if (b.ask.length && !isM) { // 入力欄で、値を聞く
      return i.showModal(new ModalBuilder().setCustomId(`cpanel:${pid}:${idxS}:m`).setTitle(b.label.slice(0, 45)).addComponents(...b.ask.map((name) => {
        const o = sc.options.find((x) => x.name === name);
        return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(name).setLabel(`${o.name}${o.required ? '' : '(省略できる)'}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(!!o.required).setPlaceholder((o.choices?.length ? o.choices.map((x) => x.name).join(' / ') : String(o.description ?? '')).slice(0, 100)));
      })));
    }
    const values = { ...b.values };
    for (const name of b.ask) {
      const o = sc.options.find((x) => x.name === name), raw = i.fields.getTextInputValue(name);
      if (!String(raw ?? '').trim() && !o.required) continue;
      const r = parseValue(o, raw); if (r.error) return say(r.error); values[name] = r.v;
    }
    return cmd.execute(asCommand(i, values, b.sub || null));
  },
};
