import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { getKV, setKV } from '../../core/db.js';
import { registerHiddenCommands, registerHelpExtras, resyncGuildCommands } from '../../core/commands.js';
import { getSettings, money } from './settings.js';
import { CRIMES, JOBS } from './jobs.js';
import { HEISTS } from './heist.js';
import { crimeOf, jobOf, heistOf, begOf, petCfg, stockCfg } from './balance.js';
import { shopItems, itemText } from './shop.js';
import { allItems, getPets, holding, peek } from './db.js';
import { marketNow, unitPrice } from './stockmarket.js';
import { petsOpen, bonusLabel } from './pets.js';
import { estateOf } from './estate.js';
import { lotteriesOf, roundOf, drawTimeOf } from './lottery.js';
import { ITEMS as MARKET_ITEMS } from './market.js';
import { COMPANIES, companyOf } from './stocks.js';
import { arrestCommand, wantedCommand, bailCommand, crimeCommand, heistCommand, workCommand, begCommand, shopCommand, useCommand, estateCommand, marketCommand, petCommand, stockCommand, newsCommand, scandalCommand, lotteryCommand } from './commands.js';

/**
 * パネル: チャンネルに置く、ボタンつきのメッセージ。コマンドを打たなくても、ボタンで、犯罪・バイト・お店が使える。
 * 設置したサーバーでは、元のコマンドを廃止できる(そのサーバーのコマンド一覧から外れる)。設置は、ダッシュボードから。
 */
export const PANELS = {
  crime: { title: '犯罪パネル', commands: ['crime', 'heist', 'arrest', 'wanted', 'bail'], added: { arrest: 3, wanted: 3, bail: 6 } },
  work: { title: 'バイトパネル', commands: ['work', 'beg'] },
  // お店パネルは、お店・不動産・闇市をまとめたもの(v2 から)
  shop: { title: 'お店パネル(お店・不動産・闇市)', commands: ['shop', 'use', 'estate', 'market'], added: { estate: 2, market: 2 } },
  pet: { title: 'ペットパネル', commands: ['pet'] },
  stock: { title: '株パネル', commands: ['stock', 'news', 'scandal'], added: { news: 4, scandal: 5 } },
  lottery: { title: '宝くじパネル', commands: ['lottery'] }, // くじは、サーバーで複数作れるので、くじを選んでから、買う・調べる
};
export const PANEL_VERSION = 6;
// そのパネルが置かれた版(v)で、パネルに載っていたコマンドだけ(あとから載せたコマンドは、置き直すまで、廃止の対象にしない)
const commandsOf = (kind, st) => PANELS[kind].commands.filter((n) => (PANELS[kind].added?.[n] ?? 0) <= (st?.v ?? 1));
/** そのパネルで、廃止しているコマンド: retire(名前の配列)があれば、それだけ。なければ(古い設定)、hide が true のとき、パネルに載っている全部のコマンド */
export const retiredOf = (kind, st) => {
  const base = commandsOf(kind, st);
  if (Array.isArray(st?.retire)) return st.retire.filter((n) => PANELS[kind].commands.includes(n));
  return st?.hide ? base : [];
};
const KEY = 'panels';
export const panelState = (g) => getKV(g, KEY, {});
const link = (g, st) => `https://discord.com/channels/${g}/${st.ch}/${st.msg}`;

// パネルを置いたサーバー(「コマンドを廃止する」がオンのもの)では、元のコマンドを、そのサーバーの一覧から外す
registerHiddenCommands((g) => {
  const out = {};
  for (const [kind, st] of Object.entries(panelState(g))) {
    if (!PANELS[kind]) continue;
    for (const name of retiredOf(kind, st)) out[name] = `このサーバーでは、\`/${name}\` は廃止されました。パネル(${link(g, st)})から使えます。`;
  }
  return out;
});

// /help に、置いてあるパネルを載せる(どこで、何ができるか)。廃止したコマンドの名前は、「/」なしで書く(/ が付くと、パネルへのリンクに置き換わってしまう)
registerHelpExtras((g) => {
  const lines = [];
  for (const [kind, st] of Object.entries(panelState(g))) {
    if (!PANELS[kind] || !st?.msg) continue;
    const gone = retiredOf(kind, st);
    lines.push(`[${PANELS[kind].title}](${link(g, st)}) — <#${st.ch}>${gone.length ? ` ・ 廃止: ${gone.join(' ')}` : ''}`);
  }
  return lines.length ? [{ name: '🧩 パネル(ボタンで使う)', value: lines.join('\n') }] : [];
});

/** コマンドの代わりに、ボタンの操作で、同じ処理を動かすための包み: i.options が、決まった値を返す */
export const asCommand = (i, values = {}, sub = null) => {
  const get = (k) => values[k] ?? null, none = () => null; // ボタンでは、ユーザー・チャンネル・ロール・ファイルは、指定できない
  const options = { getString: get, getInteger: get, getNumber: get, getBoolean: get, getUser: get, getMember: none, getChannel: none, getRole: none, getAttachment: none, getMentionable: none, getSubcommand: () => sub, getSubcommandGroup: none };
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
      embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 犯罪パネル').setDescription('ボタンを押すと、その犯罪に挑戦します。成功すると大金、失敗すると罰金と留置場です。\n警察のバイトを重ねた人は、「👮 逮捕する」で、指名手配中の人を逮捕できます(「📋 手配書」で、手配中の人を見られます)。留置場に入ったら、「🔓 保釈」で、保釈金を払って出られます。')
        .addFields({ name: '犯罪', value: crimes.map(({ c }) => `${c.emoji} **${c.name}** — 成功 ${Math.round(c.chance * 100)}% ・ 報酬 ${range(c.win)}`).join('\n') },
          { name: '大型犯罪(ミニゲーム)', value: heists.map(({ T }) => `${T.emoji} **${T.short ?? T.name}** — 報酬 ${range(T.win)}`).join('\n') })],
      components: [...rows(crimes.map(({ k, c }) => btn(`panel:crime:c:${k}`, c.name, c.emoji, ButtonStyle.Danger))), ...rows(heists.map(({ k, T }) => btn(`panel:crime:h:${k}`, T.short ?? T.name, T.emoji, ButtonStyle.Danger))),
        new ActionRowBuilder().addComponents(btn('panel:crime:arrest', '逮捕する', '👮', ButtonStyle.Primary), btn('panel:crime:wanted', '手配書', '📋'), btn('panel:crime:bail', '保釈', '🔓', ButtonStyle.Success))],
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
  const sel = (id, placeholder, options) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
  const opt = (label, value, description) => ({ label: String(label).slice(0, 100), value, ...(description ? { description: String(description).slice(0, 100) } : {}) });
  if (kind === 'pet') {
    const list = petsOpen(s), pc = petCfg(s);
    return {
      embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('🐾 ペットパネル').setDescription(`下のメニューで、ペットを飼えます(最初は ${pc.baseSlots}匹まで。不動産を買うと増えます)。育てると、ボーナスがつきます。`)
        .addFields({ name: '飼える動物', value: list.map((x) => `${x.emoji} **${x.name}** ${M(x.price)} ・ ${x.foodEmoji}${x.foodName} ${M(x.feedCost)}\n-# ${bonusLabel(x, pc.power)} / レベル`).join('\n').slice(0, 1024) || '(いません)' })],
      components: [...(list.length ? [sel('panel:pet:adopt', '🐾 ペットを飼う', list.map((x) => ({ ...opt(`${x.emoji} ${x.name} ${x.price.toLocaleString()}`, x.id, `${bonusLabel(x, pc.power)} / レベル`) })))] : []),
        new ActionRowBuilder().addComponents(btn('panel:pet:status', 'ようす', '🐾'), btn('panel:pet:feed', '餌', '🍖', ButtonStyle.Primary), btn('panel:pet:play', '遊ぶ', '🎾', ButtonStyle.Primary), btn('panel:pet:rename', '名前', '✏️'), btn('panel:pet:release', '手放す', '👋', ButtonStyle.Danger))],
    };
  }
  if (kind === 'stock') {
    return {
      embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('📈 株パネル').setDescription('架空の会社の株を、売り買いできます。株価は、決まった間隔で動きます。「📰 ニュース」で会社ごとの最近のニュース、「👥 株主」でみんなの持ち株と割合を見られます。')
        .addFields({ name: '会社', value: COMPANIES.map((c0, n) => { const c = companyOf(s, c0); return `${n + 1}. ${c.emoji} **${c.ticker}** ${c.name}`; }).join('\n') })],
      components: [new ActionRowBuilder().addComponents(btn('panel:stock:list', '株価・持ち株', '📈'), btn('panel:stock:news', 'ニュース', '📰', ButtonStyle.Primary), btn('panel:stock:buy', '買う', '🛒', ButtonStyle.Success), btn('panel:stock:sell', '売る', '💰', ButtonStyle.Danger), btn('panel:stock:holders', '株主', '👥')),
        ...(s.scandalEnabled ? [new ActionRowBuilder().addComponents(btn('panel:stock:scandal', '不祥事を起こす', '🤫', ButtonStyle.Danger))] : [])],
    };
  }
  if (kind === 'lottery') {
    const list = lotteriesOf(s), now = Date.now();
    return {
      embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('🎟️ 宝くじパネル').setDescription('くじは、いくつかあります。メニューで、買うくじを選んでから、枚数を選びます。')
        .addFields({ name: 'くじ', value: list.map((L) => { const at = Math.floor(drawTimeOf(roundOf(now, L), L) / 1000); return `${L.emoji} **${L.name}** 1枚 ${M(L.price)} ・ ${L.digits}桁 ・ 次の抽選 <t:${at}:R>`; }).join('\n').slice(0, 1024) || '(くじが、ありません)' })],
      components: [...(list.length ? [sel('panel:lottery:buy', '🎟️ くじを買う', list.map((L, n) => opt(`${L.emoji} ${L.name} ${L.price.toLocaleString()}`, String(n + 1), `${L.digits}桁 ・ 1人 ${L.maxTickets}枚まで`)))] : []),
        new ActionRowBuilder().addComponents(btn('panel:lottery:info', 'くじの情報', 'ℹ️'), btn('panel:lottery:results', '抽選結果', '📜'))],
    };
  }
  // お店パネル(お店・不動産・闇市)
  const items = shopItems(s), props = estateOf(s), fields = [], comps = [];
  if (s.shopEnabled && items.length) {
    fields.push({ name: '🏪 お店', value: items.map((it) => `${it.emoji} **${it.name}** ${M(it.price)} ・ ${it.minutes}分\n-# ${itemText(it)}`).join('\n').slice(0, 1024) });
    comps.push(sel('panel:shop:buy', '🏪 お店の品を買う', items.map((it) => opt(`${it.emoji} ${it.name} ${it.price.toLocaleString()}`, it.id, itemText(it)))));
  }
  if (s.estateEnabled && props.length) {
    fields.push({ name: '🏢 不動産', value: props.map((p) => `${p.emoji} **${p.name}** ${M(p.price)} ・ 家賃 ${M(p.rent)}/時 − 維持費 ${M(p.upkeep)}`).join('\n').slice(0, 1024) });
    comps.push(sel('panel:shop:estate', '🏢 不動産を買う', props.map((p) => opt(`${p.emoji} ${p.name} ${p.price.toLocaleString()}`, p.id, `家賃 ${p.rent}/時 − 維持費 ${p.upkeep} ・ 最大 ${p.maxOwn}件`))));
  }
  if (s.blackMarket) {
    fields.push({ name: '🕶️ 闇市', value: MARKET_ITEMS.map((x) => `${x.emoji} **${x.name}** — ${x.desc}`).join('\n').slice(0, 1024) + '\n-# 値段は、毎日少し変わります(「闇市の相場」で確認)' });
    comps.push(sel('panel:shop:market', '🕶️ 闇市で道具を買う', MARKET_ITEMS.map((x) => opt(`${x.emoji} ${x.name}`, x.id, x.desc))));
  }
  const ctl = [btn('panel:shop:list', 'お店の一覧', '📋'), btn('panel:shop:use', '使う', '🎒', ButtonStyle.Success)];
  if (s.estateEnabled) ctl.push(btn('panel:shop:collect', '家賃を受け取る', '💰', ButtonStyle.Success), btn('panel:shop:estlist', '不動産の一覧', '🏢'));
  if (s.blackMarket) ctl.push(btn('panel:shop:mlist', '闇市の相場', '🕶️'));
  return {
    embeds: [new EmbedBuilder().setColor(0xb8860b).setTitle('🏪 お店パネル').setDescription('下のメニューで、品を1つ買います(買う品を選ぶと、すぐに買います)。買った品は、「🎒 使う」で使います(しばらく、効果がつきます)。').addFields(...(fields.length ? fields : [{ name: '品物', value: '(いま、売っているものは、ありません)' }]))],
    components: [...comps, new ActionRowBuilder().addComponents(ctl.slice(0, 5))],
  };
}

const retireList = (kind, v) => (v === true ? PANELS[kind].commands : Array.isArray(v) ? v.filter((n) => PANELS[kind].commands.includes(n)) : []);
/** パネルを置く(すでにあれば、置き直す)。hide が true なら、元のコマンドを、このサーバーで廃止する */
export async function installPanel(client, g, kind, channelId, retire, sticky = true) { // retire: 廃止するコマンドの名前の配列(true なら、全部、false なら、なし)
  if (!PANELS[kind]) throw new Error('パネルの種類が不正です');
  const ch = client.channels.cache.get(channelId); if (!ch?.isTextBased?.() || ch.guildId !== g) throw new Error('チャンネルが不正です');
  const st = panelState(g), old = st[kind], payload = panelMessage(kind, g);
  let msg = null;
  if (old?.msg && old.ch === ch.id) { try { msg = await ch.messages.edit(old.msg, payload); } catch { /* 消されていたら、新しく置く */ } }
  if (!msg) {
    if (old?.msg && old.ch !== ch.id) await client.channels.cache.get(old.ch)?.messages.delete(old.msg).catch(() => {}); // 別のチャンネルにあった前のものは、消す
    msg = await ch.send({ ...payload, allowedMentions: { parse: [] } });
  }
  setKV(g, KEY, { ...st, [kind]: { ch: ch.id, msg: msg.id, retire: retireList(kind, retire), hide: retireList(kind, retire).length > 0, sticky: !!sticky, v: PANEL_VERSION, at: Date.now() } });
  await resyncGuildCommands(g);
  return panelState(g)[kind];
}
/** パネルが、チャンネルの一番下になければ、前のものを消して、一番下に出し直す(すでに一番下なら、何もしない) */
export async function repostPanel(client, g, kind) {
  const st = panelState(g)[kind]; if (!st || st.sticky === false) return false;
  const ch = client.channels.cache.get(st.ch); if (!ch?.isTextBased?.() || ch.guildId !== g) return false;
  if (ch.lastMessageId === st.msg) return false;
  await ch.messages.delete(st.msg).catch(() => {}); // 履歴を読む権限が無くても、消せる
  const msg = await ch.send({ ...panelMessage(kind, g), allowedMentions: { parse: [] } });
  setKV(g, KEY, { ...panelState(g), [kind]: { ...panelState(g)[kind], msg: msg.id, at: Date.now() } });
  return true;
}
/** 「一番下に出す」の対象。パネルは、値段表・株価グラフより下(prio が大きい)に出す */
export const panelStickItems = (client) => Object.keys(PANELS).map((kind, n) => ({ kind: `panel:${kind}`, prio: 100 + n,
  state: (g) => { const st = panelState(g)[kind]; return st && st.sticky !== false ? { ch: st.ch, msg: st.msg } : null; }, run: (g) => repostPanel(client, g, kind) }));
/** パネルを外す。メッセージを消して、廃止していたコマンドを、元に戻す */
export async function removePanel(client, g, kind) {
  const st = panelState(g), old = st[kind]; if (!old) return false;
  await client.channels.cache.get(old.ch)?.messages.delete(old.msg).catch(() => {});
  const { [kind]: _gone, ...rest } = st; setKV(g, KEY, rest);
  await resyncGuildCommands(g);
  return true;
}

/** パネルのボタン・選択メニュー・入力欄(モーダル)の処理 */
const EPH = { flags: MessageFlags.Ephemeral };
const modal = (id, title, label, placeholder, required = true) => new ModalBuilder().setCustomId(id).setTitle(title).addComponents(new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId('v').setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(20).setPlaceholder(placeholder)));
const intOf = (i) => { const n = Math.floor(Number(String(i.fields.getTextInputValue('v') ?? '').normalize('NFKC').replace(/[,\s]/g, ''))); return Number.isFinite(n) ? n : null; };
const selectRow = (id, placeholder, options) => new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(placeholder).addOptions(options.slice(0, 25)));
/** 選ぶ途中の画面(自分にだけ見えるメッセージ)を、閉じる: メッセージごと、消す。消せないときだけ、「キャンセルしました」と書き換える */
export const closePrompt = async (i) => {
  try { await i.deferUpdate(); await i.deleteReply(); }
  catch { try { await i.editReply({ content: 'キャンセルしました。', components: [], embeds: [] }); } catch { /* もう、閉じられている */ } }
};
const cancelRow = () => new ActionRowBuilder().addComponents(btn('panel:cancel', 'キャンセル', '❌'));
export const panelComponent = {
  id: 'panel',
  async execute(i) {
    const [, kind, action, arg, arg2] = i.customId.split(':'), v0 = i.values?.[0], isModal = i.isModalSubmit?.();
    if (kind === 'cancel') return closePrompt(i); // 選ぶ途中の画面を、閉じる(メッセージごと、消す)
    const say = (content, extra = {}) => i.reply({ content, ...EPH, ...extra, ...(extra.components ? { components: [...extra.components, cancelRow()] } : {}) }); // 選ぶ画面には、キャンセルをつける
    const s = getSettings(i.guildId);
    if (kind === 'crime') {
      if (action === 'h') return heistCommand.execute(asCommand(i, { target: arg }));
      if (action === 'wanted') return wantedCommand.execute(asCommand(i, {}));
      if (action === 'bail') return bailCommand.execute(asCommand(i, {}));
      if (action === 'arrest') return say('逮捕する人を、選んでください。', { components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('panel:crime:arrestsel').setPlaceholder('逮捕する人を選ぶ').setMinValues(1).setMaxValues(1))] });
      if (action === 'arrestsel') { const target = i.users?.first?.() ?? null; return target ? arrestCommand.execute(asCommand(i, { user: target })) : say('その人が、見つかりません。'); }
      return crimeCommand.execute(asCommand(i, { type: arg }));
    }
    if (kind === 'work') return action === 'beg' ? begCommand.execute(asCommand(i)) : workCommand.execute(asCommand(i, { job: arg }));

    if (kind === 'shop') {
      const items = shopItems(s), gone = () => say('この品は、もうありません。パネルが古くなっています(管理者が、置き直せます)。');
      if (action === 'buy') { const id = arg ?? v0, n = items.findIndex((x) => x.id === id) + 1; return n ? shopCommand.execute(asCommand(i, { item: n, amount: 1 }, 'buy')) : gone(); } // arg: 古いパネルのボタン / v0: 選択メニュー
      if (action === 'list') return shopCommand.execute(asCommand(i, {}, 'list'));
      if (action === 'estate') { const n = estateOf(s).findIndex((x) => x.id === v0) + 1; return n ? estateCommand.execute(asCommand(i, { property: n, count: 1 }, 'buy')) : gone(); }
      if (action === 'estlist') return estateCommand.execute(asCommand(i, {}, 'list'));
      if (action === 'collect') return estateCommand.execute(asCommand(i, {}, 'collect'));
      if (action === 'market') return MARKET_ITEMS.some((x) => x.id === v0) ? marketCommand.execute(asCommand(i, { item: v0, amount: 1 }, 'buy')) : gone();
      if (action === 'mlist') return marketCommand.execute(asCommand(i, {}, 'list'));
      if (action === 'use') {
        const own = allItems(i.guildId, i.user.id), have = items.filter((x) => own[x.id] > 0);
        if (!have.length) return say('使える品を、持っていません。メニューで買えます。');
        return say('使う品を、選んでください。', { components: [selectRow('panel:shop:usesel', '品を選ぶ', have.map((x) => ({ label: `${x.name}(持っている数 ${own[x.id]})`.slice(0, 100), value: x.id, description: itemText(x).slice(0, 100) || undefined })))] });
      }
      if (action === 'usesel') { const n = items.findIndex((x) => x.id === v0) + 1; return n ? useCommand.execute(asCommand(i, { item: n })) : gone(); }
      return;
    }

    if (kind === 'pet') {
      const pets = getPets(i.guildId, i.user.id), list = petsOpen(s);
      const run = (act, n) => {
        if (act === 'feed' || act === 'play') return petCommand.execute(asCommand(i, { pet: n }, act));
        if (act === 'rename') return i.showModal(modal(`panel:pet:renamem:${n}`, '名前を変える', '新しい名前(12文字まで)', 'ポチ'));
        if (act === 'release') return say(`${pets[n - 1].name} を、手放しますか?(お金は戻りません)`, { components: [new ActionRowBuilder().addComponents(btn(`panel:pet:releasec:${n}`, '手放す', '👋', ButtonStyle.Danger))] });
      };
      if (action === 'status') return petCommand.execute(asCommand(i, {}, 'status'));
      if (action === 'adopt') { const n = list.findIndex((x) => x.id === v0) + 1; return n ? petCommand.execute(asCommand(i, { species: n }, 'adopt')) : say('その動物は、もういません。パネルが古くなっています。'); }
      if (action === 'renamem') return petCommand.execute(asCommand(i, { name: i.fields.getTextInputValue('v'), pet: Number(arg) }, 'rename'));
      if (action === 'releasec') return petCommand.execute(asCommand(i, { confirm: true, pet: Number(arg) }, 'release'));
      if (['feed', 'play', 'rename', 'release'].includes(action)) {
        if (!pets.length) return say('ペットがいません。メニューで飼えます。');
        if (pets.length === 1) return run(action, 1);
        return say('どの子にしますか?', { components: [selectRow(`panel:pet:pick:${action}`, 'ペットを選ぶ', pets.map((p, n) => ({ label: `${n + 1}. ${p.name}`, value: String(n + 1) })))] });
      }
      if (action === 'pick') return run(arg, Number(v0));
      return;
    }

    if (kind === 'lottery') {
      const list = lotteriesOf(s), pickMenu = (id, title, withAll) => say(title, { components: [selectRow(id, 'くじを選ぶ', [...(withAll ? [{ label: '全部のくじ(一覧)', value: '0' }] : []), ...list.map((L, n) => ({ label: `${L.emoji} ${L.name}`.slice(0, 100), value: String(n + 1) }))])] });
      if (action === 'info') return pickMenu('panel:lottery:infosel', 'どのくじの情報を、見ますか?', true);
      if (action === 'results') return pickMenu('panel:lottery:resultssel', 'どのくじの抽選結果を、見ますか?', false);
      if (action === 'infosel') return lotteryCommand.execute(asCommand(i, { lottery: Number(v0) || null }, 'info'));
      if (action === 'resultssel') return lotteryCommand.execute(asCommand(i, { lottery: Number(v0) }, 'results'));
      if (action === 'buy') { // くじを選んだ → 枚数を選ぶ
        const L = list[Number(v0) - 1]; if (!L) return say('そのくじは、もうありません。パネルが古くなっています。');
        return i.reply({ ...EPH, content: `${L.emoji} ${L.name}(1枚 ${money(s, L.price)})を、何枚買いますか?`, // パネル(みんなに見える)は、そのままにして、自分にだけ見える画面を、別に出す
           components: [selectRow(`panel:lottery:amt:${v0}`, '枚数を選ぶ', [...[1, 5, 10, 50, 100].filter((n) => n <= L.maxTickets).map((n) => ({ label: `${n}枚(番号は、ランダム)`, value: String(n) })), { label: '連番で買う…(開始番号と枚数)', value: 'seq' }, { label: '番号を決めて買う…(いくつでも)', value: 'custom' }]), cancelRow()] });
      }
      if (action === 'amt') {
        if (v0 === 'custom') return i.showModal(new ModalBuilder().setCustomId(`panel:lottery:m:${arg}`).setTitle('くじを買う').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('枚数(番号を入れたら、省略できる)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(6).setPlaceholder('例: 5')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('numbers').setLabel('番号(いくつでも。カンマ区切り。100-110で連番)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100).setPlaceholder('例: 123, 456, 789(足りない枚数は、ランダム)'))));
        if (v0 === 'seq') return i.showModal(new ModalBuilder().setCustomId(`panel:lottery:q:${arg}`).setTitle('連番で買う').addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('start').setLabel('開始番号').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setPlaceholder('例: 100')),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('count').setLabel('枚数(開始番号から、1ずつ増える)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setPlaceholder('例: 10(100〜109)'))));
        return lotteryCommand.execute(asCommand(i, { lottery: Number(arg), count: Number(v0) }, 'buy'));
      }
      if (action === 'q') { // 連番: 開始番号から、枚数ぶん
        const toN = (x) => { const n = Math.floor(Number(String(x ?? '').normalize('NFKC').replace(/[,\s]/g, ''))); return Number.isFinite(n) ? n : null; };
        const start = toN(i.fields.getTextInputValue('start')), count = toN(i.fields.getTextInputValue('count'));
        if (start === null || start < 0) return say('開始番号は、0以上の数字で入れてください。'); if (!count || count < 1) return say('枚数は、1以上の数字で入れてください。');
        return lotteryCommand.execute(asCommand(i, { lottery: Number(arg), count: null, numbers: `${start}-${start + count - 1}` }, 'buy'));
      }
      if (action === 'm') { // 入力欄の送信: 枚数と、番号(いくつか)。番号は1枚ずつ、足りない枚数は、ランダム
        const toN = (x) => { const n = Math.floor(Number(String(x ?? '').normalize('NFKC').replace(/[,\s]/g, ''))); return Number.isFinite(n) ? n : null; };
        const rawC = String(i.fields.getTextInputValue('count') ?? '').trim(), numbers = String(i.fields.getTextInputValue('numbers') ?? '').trim(), count = rawC === '' ? null : toN(rawC);
        if (rawC !== '' && (!count || count < 1)) return say('枚数は、1以上の数字で入れてください。');
        if (rawC === '' && numbers === '') return say('枚数か、番号の、どちらかを入れてください。');
        if (numbers !== '' && !/\d/.test(numbers)) return say('番号は、数字で入れてください。(例: 123, 456)');
        return lotteryCommand.execute(asCommand(i, { lottery: Number(arg), count, numbers: numbers || null }, 'buy'));
      }
      return;
    }
    if (kind === 'stock') {
      const names = COMPANIES.map((c0) => { const c = companyOf(s, c0); return `${c.emoji} ${c.ticker} ${c.name}`; });
      if (action === 'list') return stockCommand.execute(asCommand(i, {}, 'list'));
      if (action === 'news') return say('どの会社のニュースを、見ますか?', { components: [selectRow('panel:stock:newssel', '会社を選ぶ', [{ label: '全部の会社', value: '0' }, ...names.map((nm, n) => ({ label: nm.slice(0, 100), value: String(n + 1) }))])] });
      if (action === 'newssel') return newsCommand.execute(asCommand(i, { company: Number(v0) || null }));
      if (action === 'holders') return say('どの会社の株主を、見ますか?', { components: [selectRow('panel:stock:holderssel', '会社を選ぶ', [{ label: '全部の会社(まとめ)', value: '0' }, ...names.map((nm, n) => ({ label: nm.slice(0, 100), value: String(n + 1) }))])] });
      if (action === 'holderssel') return stockCommand.execute(asCommand(i, { company: Number(v0) || null }, 'holders'));
      if (action === 'scandal') return say('どの会社に、不祥事を起こしますか?(お金がかかります。ばれることもあります)', { components: [selectRow('panel:stock:scandalsel', '会社を選ぶ', names.map((nm, n) => ({ label: nm.slice(0, 100), value: String(n + 1) })))] });
      if (action === 'scandalsel') return scandalCommand.execute(asCommand(i, { company: Number(v0) }));
      if (action === 'buy' || action === 'sell') return say(action === 'buy' ? 'どの会社の株を、買いますか?' : 'どの会社の株を、売りますか?', { components: [selectRow(`panel:stock:pick:${action}`, '会社を選ぶ', names.map((nm, n) => ({ label: nm.slice(0, 100), value: String(n + 1) })))] });
      if (action === 'pick') { // 会社を選んだ → 株数を、プルダウンで選ぶ(自分で入力もできる)
        const co = companyOf(s, COMPANIES[Number(v0) - 1] ?? COMPANIES[0]), opts = [1, 5, 10, 50, 100, 500].map((n) => ({ label: `${n.toLocaleString()}株`, value: String(n) }));
        opts.push(arg === 'buy' ? { label: '買える限り(手持ちと、持てる上限まで)', value: 'max' } : { label: '持っている全部', value: 'all' }, { label: '株数を入力する…', value: 'custom' });
        return i.update({ content: `${co.emoji} ${co.name} の株を、何株${arg === 'buy' ? '買い' : '売り'}ますか?`, components: [selectRow(`panel:stock:amt:${arg}:${v0}`, '株数を選ぶ', opts), cancelRow()] });
      }
      if (action === 'amt') {
        if (v0 === 'custom') return i.showModal(modal(`panel:stock:m:${arg}:${arg2}`, arg === 'buy' ? '株を買う' : '株を売る', arg === 'buy' ? '株数' : '株数(空欄で、持っている全部)', '10', arg === 'buy'));
        let shares = v0 === 'all' ? null : Number(v0);
        if (v0 === 'max') { // 買える限り: 手持ち・手数料・持てる上限から、計算する
          const cfg = stockCfg(s), m = marketNow(s, i.guildId)[Number(arg2) - 1]; if (!m) return say('その会社は、ありません。');
          const px = unitPrice(m.price), wallet = peek(i.guildId, i.user.id).wallet, held = holding(i.guildId, i.user.id, m.company.id).shares;
          let n = Math.min(Math.floor(wallet / (px * (1 + cfg.fee))), cfg.maxShares - held);
          while (n > 0 && px * n + Math.ceil(px * n * cfg.fee) > wallet) n--;
          if (n < 1) return say('買える株が、ありません。(手持ちが足りないか、持てる上限です)');
          shares = n;
        }
        return stockCommand.execute(asCommand(i, { company: Number(arg2), shares }, arg));
      }
      if (action === 'm') {
        const n = intOf(i);
        if (arg === 'buy' && (n === null || n < 1)) return say('株数は、1以上の数字で入れてください。');
        return stockCommand.execute(asCommand(i, { company: Number(arg2), shares: n && n > 0 ? n : null }, arg));
      }
    }
  },
};
