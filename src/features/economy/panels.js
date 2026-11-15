import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } from 'discord.js';
import { getKV, setKV } from '../../core/db.js';
import { registerHiddenCommands, resyncGuildCommands } from '../../core/commands.js';
import { getSettings, money } from './settings.js';
import { CRIMES, JOBS } from './jobs.js';
import { HEISTS } from './heist.js';
import { crimeOf, jobOf, heistOf, begOf } from './balance.js';
import { shopItems, itemText } from './shop.js';
import { allItems } from './db.js';
import { crimeCommand, heistCommand, workCommand, begCommand, shopCommand, useCommand } from './commands.js';

/**
 * パネル: チャンネルに置く、ボタンつきのメッセージ。コマンドを打たなくても、ボタンで、犯罪・バイト・お店が使える。
 * 設置したサーバーでは、元のコマンドを廃止できる(そのサーバーのコマンド一覧から外れる)。設置は、ダッシュボードから。
 */
export const PANELS = {
  crime: { title: '犯罪パネル', commands: ['crime', 'heist'] },
  work: { title: 'バイトパネル', commands: ['work', 'beg'] },
  shop: { title: 'お店パネル', commands: ['shop', 'use'] },
};
const KEY = 'panels';
export const panelState = (g) => getKV(g, KEY, {});
const link = (g, st) => `https://discord.com/channels/${g}/${st.ch}/${st.msg}`;

// パネルを置いたサーバー(「コマンドを廃止する」がオンのもの)では、元のコマンドを、そのサーバーの一覧から外す
registerHiddenCommands((g) => {
  const out = {};
  for (const [kind, st] of Object.entries(panelState(g))) {
    if (!st?.hide || !PANELS[kind]) continue;
    for (const name of PANELS[kind].commands) out[name] = `このサーバーでは、\`/${name}\` は廃止されました。パネル(${link(g, st)})から使えます。`;
  }
  return out;
});

/** コマンドの代わりに、ボタンの操作で、同じ処理を動かすための包み: i.options が、決まった値を返す */
export const asCommand = (i, values = {}, sub = null) => {
  const options = { getString: (k) => values[k] ?? null, getInteger: (k) => values[k] ?? null, getBoolean: (k) => values[k] ?? null, getUser: () => null, getSubcommand: () => sub };
  return new Proxy(i, { get(t, k) { if (k === 'options') return options; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } });
};

const btn = (id, label, emoji, style = ButtonStyle.Secondary) => {
  const b = new ButtonBuilder().setCustomId(id).setStyle(style);
  try { if (emoji) b.setEmoji(emoji); b.setLabel(String(label).slice(0, 78)); } catch { b.setLabel(`${emoji ?? ''} ${label}`.trim().slice(0, 78)); }
  return b;
};
const rows = (buttons) => { const out = []; for (let n = 0; n < buttons.length; n += 5) out.push(new ActionRowBuilder().addComponents(buttons.slice(n, n + 5))); return out; };

/** パネルのメッセージ(埋め込み + ボタン)を作る。品や数字は、いまのサーバーの設定を反映する */
export function panelMessage(kind, g) {
  const s = getSettings(g), M = (n) => money(s, n);
  const range = ([a, b]) => `${a.toLocaleString()}〜${b.toLocaleString()}`;
  if (kind === 'crime') {
    const crimes = Object.keys(CRIMES).map((k) => ({ k, c: crimeOf(s, k) })), heists = Object.keys(HEISTS).map((k) => ({ k, T: heistOf(s, k) }));
    return {
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 犯罪パネル').setDescription('ボタンを押すと、その犯罪に挑戦します。成功すると大金、失敗すると罰金と留置場です。')
        .addFields({ name: '犯罪', value: crimes.map(({ c }) => `${c.emoji} **${c.name}** — 成功 ${Math.round(c.chance * 100)}% ・ 報酬 ${range(c.win)}`).join('\n') },
          { name: '大型犯罪(ミニゲーム)', value: heists.map(({ T }) => `${T.emoji} **${T.short ?? T.name}** — 報酬 ${range(T.win)}`).join('\n') })],
      components: [...rows(crimes.map(({ k, c }) => btn(`panel:crime:c:${k}`, c.name, c.emoji, ButtonStyle.Danger))), ...rows(heists.map(({ k, T }) => btn(`panel:crime:h:${k}`, T.short ?? T.name, T.emoji, ButtonStyle.Danger)))],
    };
  }
  if (kind === 'work') {
    const jobs = Object.keys(JOBS).map((k) => ({ k, j: jobOf(s, k) })), beg = begOf(s);
    return {
      embeds: [new EmbedBuilder().setColor(0x3498db).setTitle('💼 バイトパネル').setDescription('ボタンを押すと、そのバイトをして、給料をもらいます。')
        .addFields({ name: 'バイト', value: jobs.map(({ j }) => `${j.emoji} **${j.name}** — 給料 ${range(j.pay)}`).join('\n') }, { name: '乞食', value: `🙏 道ばたで、お金をめぐんでもらいます(待ち時間 ${Math.round(beg.cd / 60000)}分)` })],
      components: rows([...jobs.map(({ k, j }) => btn(`panel:work:j:${k}`, j.name, j.emoji, ButtonStyle.Primary)), btn('panel:work:beg', '乞食', '🙏')]),
    };
  }
  const items = shopItems(s);
  return {
    embeds: [new EmbedBuilder().setColor(0xb8860b).setTitle('🏪 お店パネル').setDescription('品のボタンを押すと、1つ買います。買った品は、「🎒 使う」で使います(しばらく、効果がつきます)。')
      .addFields({ name: '品物', value: items.map((it) => `${it.emoji} **${it.name}** ${M(it.price)} ・ ${it.minutes}分\n-# ${itemText(it)}`).join('\n').slice(0, 1024) || '(品がありません)' })],
    components: [...rows(items.map((it) => btn(`panel:shop:buy:${it.id}`, `${it.name} ${it.price.toLocaleString()}`, it.emoji))), new ActionRowBuilder().addComponents(btn('panel:shop:list', '一覧', '📋'), btn('panel:shop:use', '使う', '🎒', ButtonStyle.Success))],
  };
}

/** パネルを置く(すでにあれば、置き直す)。hide が true なら、元のコマンドを、このサーバーで廃止する */
export async function installPanel(client, g, kind, channelId, hide) {
  if (!PANELS[kind]) throw new Error('パネルの種類が不正です');
  const ch = client.channels.cache.get(channelId); if (!ch?.isTextBased?.() || ch.guildId !== g) throw new Error('チャンネルが不正です');
  const st = panelState(g), old = st[kind], payload = panelMessage(kind, g);
  let msg = null;
  if (old?.msg && old.ch === ch.id) { try { msg = await (await ch.messages.fetch(old.msg)).edit(payload); } catch { /* 消されていたら、新しく置く */ } }
  if (!msg) {
    if (old?.msg && old.ch !== ch.id) { try { await (await client.channels.cache.get(old.ch)?.messages.fetch(old.msg))?.delete(); } catch { /* もう無い */ } }
    msg = await ch.send({ ...payload, allowedMentions: { parse: [] } });
  }
  setKV(g, KEY, { ...st, [kind]: { ch: ch.id, msg: msg.id, hide: !!hide, at: Date.now() } });
  await resyncGuildCommands(g);
  return panelState(g)[kind];
}
/** パネルを外す。メッセージを消して、廃止していたコマンドを、元に戻す */
export async function removePanel(client, g, kind) {
  const st = panelState(g), old = st[kind]; if (!old) return false;
  try { await (await client.channels.cache.get(old.ch)?.messages.fetch(old.msg))?.delete(); } catch { /* もう無い */ }
  const { [kind]: _gone, ...rest } = st; setKV(g, KEY, rest);
  await resyncGuildCommands(g);
  return true;
}

/** パネルのボタン・選択メニューの処理 */
export const panelComponent = {
  id: 'panel',
  async execute(i) {
    const [, kind, action, arg] = i.customId.split(':');
    if (kind === 'crime') return action === 'h' ? heistCommand.execute(asCommand(i, { target: arg })) : crimeCommand.execute(asCommand(i, { type: arg }));
    if (kind === 'work') return action === 'beg' ? begCommand.execute(asCommand(i)) : workCommand.execute(asCommand(i, { job: arg }));
    if (kind !== 'shop') return;
    const s = getSettings(i.guildId), items = shopItems(s), gone = () => i.reply({ content: 'この品は、もうありません。パネルが古くなっています(管理者が、置き直せます)。', flags: MessageFlags.Ephemeral });
    if (action === 'buy') { const n = items.findIndex((x) => x.id === arg) + 1; return n ? shopCommand.execute(asCommand(i, { item: n, amount: 1 }, 'buy')) : gone(); }
    if (action === 'list') return shopCommand.execute(asCommand(i, {}, 'list'));
    if (action === 'use') {
      const own = allItems(i.guildId, i.user.id), have = items.filter((x) => own[x.id] > 0);
      if (!have.length) return i.reply({ content: '使える品を、持っていません。品のボタンで買えます。', flags: MessageFlags.Ephemeral });
      return i.reply({ content: '使う品を、選んでください。', flags: MessageFlags.Ephemeral,
        components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('panel:shop:usesel').setPlaceholder('品を選ぶ').addOptions(have.slice(0, 25).map((x) => ({ label: `${x.name}(持っている数 ${own[x.id]})`.slice(0, 100), value: x.id, description: itemText(x).slice(0, 100) || undefined }))))] });
    }
    if (action === 'usesel') { const n = items.findIndex((x) => x.id === i.values?.[0]) + 1; return n ? useCommand.execute(asCommand(i, { item: n })) : gone(); }
  },
};
