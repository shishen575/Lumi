import { chanOf } from '../../core/channels.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { getKV, setKV } from '../../core/db.js';
import { commandCatalog, commandCategories, findCommand, registerHiddenCommands, registerHelpExtras, resyncGuildCommands } from '../../core/commands.js';
import { asCommand, closePrompt } from './panels.js';
import { schemaOf, parseValue } from './custompanels.js';

/**
 * カテゴリーパネル: コマンドを、カテゴリーごとに、1つずつ独立したパネル(ボタンのメッセージ)にする。
 * パネルを押すと、必要な項目(選択肢・ユーザー・数字など)を、順に聞いて、コマンドを実行する。
 * 犯罪・バイト・お店・ペット・株は、専用のパネル(panels.js)がある。ここは、それ以外のカテゴリー(お金・宝くじ・ギャンブル・管理者向け・活動ロール・大喜利など)
 */
const KEY = 'catpanels';
const EPH = { flags: MessageFlags.Ephemeral };
// パネルに出さない(いつも、コマンドのまま): 通信の速さ・更新内容・ヘルプ・詳しい説明
export const HUB_EXCLUDE = new Set(['ping', 'releasenotes', 'help', 'detail', 'balance-edit', 'cooldown-reset', 'release', 'blackjack-end']); // 管理者向けのコマンドも、パネルには出さない
export const BUILTIN_CATEGORIES = new Set(['crime', 'work', 'shop', 'pet', 'stock', 'lottery']); // 専用のパネルがあるカテゴリー
export const catPanels = (g) => getKV(g, KEY, {});
const link = (g, st) => `https://discord.com/channels/${g}/${st.ch}/${st.msg}`;
const catById = (id) => commandCategories().find((c) => c.id === id);
const cmdsOf = (cat) => cat.commands.filter((n) => !HUB_EXCLUDE.has(n));
/** そのパネルで、廃止しているコマンド(名前の配列。カテゴリーのコマンドの中から) */
export const catRetired = (id, st) => { const cat = catById(id); return cat && st?.msg ? (st.retire ?? []).filter((n) => cmdsOf(cat).includes(n)) : []; };

registerHiddenCommands((g) => {
  const out = {};
  for (const [id, st] of Object.entries(catPanels(g))) for (const name of catRetired(id, st)) out[name] = `このサーバーでは、\`/${name}\` は廃止されました。パネル(${link(g, st)})から使えます。`;
  return out;
});
registerHelpExtras((g) => {
  const lines = Object.entries(catPanels(g)).filter(([id, st]) => st?.msg && catById(id)).map(([id, st]) => { const c = catById(id), gone = catRetired(id, st); return `[${c.emoji ?? '📁'} ${c.title}パネル](${link(g, st)}) — <#${st.ch}>${gone.length ? ` ・ 廃止: ${gone.join(' ')}` : ''}`; });
  return lines.length ? [{ name: '🧩 カテゴリーパネル', value: lines.join('\n') }] : [];
});


/** ボタンの名前(コマンド名ではなく、わかりやすい言葉)。キーは「コマンド」または「コマンド サブコマンド」 */
const LABELS = {
  // お金
  balance: ['🪙', '残高'], deposit: ['🏦', '預ける'], withdraw: ['💵', '引き出す'], richest: ['🏆', 'お金持ちランキング'], pay: ['💸', '送金'], cooldowns: ['⏱️', '待ち時間'],
  // 犯罪・バイト
  crime: ['🚨', '犯罪'], heist: ['🏦', '大型犯罪'], arrest: ['👮', '逮捕'], wanted: ['📋', '手配書'], bail: ['🔓', '保釈'], work: ['💼', 'バイト'], beg: ['🙏', '乞食'], job: ['🎖️', '職業・階級'],
  // お店・闇市・不動産
  'shop list': ['📋', 'お店の一覧'], 'shop buy': ['🛒', 'お店で買う'], use: ['🎒', '品を使う'], 'give shop': ['🎁', '品をあげる'], 'give market': ['🎁', '道具をあげる'],
  'market list': ['🕶️', '闇市の相場'], 'market buy': ['🛒', '闇市で買う'], 'estate list': ['🏢', '不動産の一覧'], 'estate buy': ['🏠', '不動産を買う'], 'estate sell': ['💱', '不動産を売る'], 'estate collect': ['💰', '家賃を受け取る'],
  // ペット
  'pet status': ['🐾', 'ペットのようす'], 'pet adopt': ['🐶', 'ペットを飼う'], 'pet feed': ['🍖', '餌をあげる'], 'pet play': ['🎾', '遊ぶ'], 'pet rename': ['✏️', 'ペットの名前'], 'pet release': ['👋', 'ペットを手放す'],
  // 株
  'stock list': ['📈', '株価・持ち株'], 'stock holders': ['👥', '株主'], 'stock buy': ['🛒', '株を買う'], 'stock sell': ['💰', '株を売る'], news: ['📰', '株のニュース'], scandal: ['🤫', '不祥事を起こす'],
  // 宝くじ・ギャンブル
  'lottery info': ['🎟️', 'くじの情報'], 'lottery buy': ['🎟️', 'くじを買う'], 'lottery results': ['📜', '抽選結果'], chinchiro: ['🎲', 'チンチロ'], slot: ['🎰', 'スロット'], blackjack: ['🃏', 'ブラックジャック'],
  // 管理者向け
  'balance-edit': ['✏️', '残高を編集'], 'cooldown-reset': ['⏱️', '待ち時間を解除'], release: ['🔓', '釈放'], 'blackjack-end': ['🛑', 'ブラックジャックを終了'],
  // 活動ロール・大喜利
  rank: ['📊', 'ランク'], top: ['🏆', 'ランキング'], roles: ['🎖️', 'ロール一覧'], odai: ['💡', 'お題を出す'], kaitou: ['✍️', 'お題に回答'], kekka: ['📣', '結果を発表'], ranking: ['🌱', '大喜利ランキング'], best: ['🌿', '一番の草'], kusaemoji: ['🌱', '草の絵文字'], up: ['⬇️', 'お題を下に出す'],
};
/** ボタンの、絵文字と名前。決めていないコマンドは、説明の、はじめの部分を使う */
const labelOf = (name, sub, desc) => { const l = LABELS[sub ? `${name} ${sub}` : name]; return l ? { emoji: l[0], label: l[1] } : { emoji: null, label: String(desc).split(/[(。(]/)[0].slice(0, 20) || name }; };

/** 1つのコマンド(+サブコマンド)を、ボタンにできるか。できないときは、null。必要な項目を、聞く順番に並べて返す */
// 預ける・引き出す: 金額を、選ぶか、入力する(どちらも省略できる項目だが、聞かないと、動かない)
const AMOUNTS = [{ name: '全額', values: { all: true } }, ...[100, 500, 1000, 5000, 10000].map((n) => ({ name: n.toLocaleString(), values: { amount: n } })), { name: '金額を入力…', ask: true }];
/** 選ぶ項目の、選択肢の一覧: [{ name, value | values | skip | ask }] */
const listOf = (stp) => (stp.t === 'qty' ? [...[1, 2, 3, 5, 10, 20, 50].map((n) => ({ name: `${n}個`, value: n })), { name: '個数を入力…', ask: true }] : stp.t === 'amount' ? AMOUNTS : stp.t === 'optpick' ? [{ name: '指定しない(おまかせ)', skip: true }, ...stp.o.choices.map((c) => ({ name: c.name, value: c.value }))] : stp.o.type === 5 ? [{ name: 'オン', value: true }, { name: 'オフ', value: false }] : stp.o.choices.map((c) => ({ name: c.name, value: c.value })));
function stepsOf(name, sub) {
  const json = commandCatalog().find((c) => c.name === name); if (!json) return null;
  const sc = schemaOf(json, sub || null); if (sc.error) return null;
  if (!sub && (name === 'deposit' || name === 'withdraw')) return { json, sc, steps: [{ t: 'amount', o: sc.options.find((o) => o.name === 'amount') }] };
  const req = sc.options.filter((o) => o.required);
  if (req.some((o) => ![3, 4, 5, 6, 10].includes(o.type))) return null;          // チャンネル・ロール・ファイルが必須のものは、使えない
  if (req.filter((o) => o.type === 6).length > 1) return null;                   // ユーザーを2人以上は、聞けない
  const picks = req.filter((o) => (o.choices?.length || o.type === 5) && o.type !== 6), users = req.filter((o) => o.type === 6), asks = req.filter((o) => !o.choices?.length && o.type !== 5 && o.type !== 6);
  if (asks.length > 5) return null;
  const qty = sc.options.find((o) => !o.required && o.type === 4 && (o.name === 'amount' || o.name === 'count')); // 個数(買う・あげる)は、プルダウンで聞く
  const optPicks = sc.options.filter((o) => !o.required && o.choices?.length && o.type !== 6); // 省略できる選択肢の項目も、聞く(「指定しない」を選べる)
  return { json, sc, steps: [...picks.map((o) => ({ t: 'pick', o })), ...optPicks.map((o) => ({ t: 'optpick', o })), ...(qty ? [{ t: 'qty', o: qty }] : []), ...users.map((o) => ({ t: 'user', o })), ...(asks.length ? [{ t: 'ask', os: asks }] : [])] };
}
/** カテゴリーの、ボタンの一覧: [{ name, sub, label, desc }] */
export function buttonsOf(cat) {
  const out = [];
  for (const name of cat.commands.filter((n) => !HUB_EXCLUDE.has(n))) {
    const json = commandCatalog().find((c) => c.name === name); if (!json) continue;
    const subs = (json.options ?? []).filter((o) => o.type === 1);
    if (!subs.length) { if (stepsOf(name, null)) out.push({ name, sub: '', ...labelOf(name, '', json.description), desc: json.description }); continue; }
    for (const sc of subs) if (stepsOf(name, sc.name)) out.push({ name, sub: sc.name, ...labelOf(name, sc.name, sc.description), desc: sc.description });
  }
  return out;
}

const hubButton = (b) => { const x = new ButtonBuilder().setCustomId(`hub:b:${b.name}:${b.sub}`).setStyle(ButtonStyle.Secondary); try { if (b.emoji) x.setEmoji(b.emoji); x.setLabel(b.label.slice(0, 78)); } catch { x.setLabel(`${b.emoji ?? ''} ${b.label}`.trim().slice(0, 78)); } return x; };
/** カテゴリーのパネルの、メッセージ(説明 + コマンドのボタン。25個まで) */
export function catMessage(cat) {
  const bs = buttonsOf(cat).slice(0, 25), rows = [];
  for (let n = 0; n < bs.length; n += 5) rows.push(new ActionRowBuilder().addComponents(bs.slice(n, n + 5).map((b) => hubButton(b))));
  return { embeds: [new EmbedBuilder().setColor(0x6d5dfc).setTitle(`${cat.emoji ?? '📁'} ${cat.title}`).setDescription(`ボタンを押すと、必要なこと(選択肢・ユーザー・数字など)を聞かれて、コマンドが動きます。\n\n${bs.map((b) => `${b.emoji ?? '▫️'} **${b.label}** — ${b.desc}`).join('\n').slice(0, 3800)}`)], components: rows };
}

export async function installCatPanel(client, g, id, channelId, retire, sticky = true) {
  const cat = catById(id); if (!cat || !buttonsOf(cat).length) throw new Error('そのカテゴリーは、ありません');
  const ch = (await chanOf(client, channelId)); if (!ch?.isTextBased?.() || ch.guildId !== g) throw new Error('チャンネルが不正です');
  const all = catPanels(g), old = all[id], payload = catMessage(cat), names = cmdsOf(cat), retireNames = retire === true ? names : (Array.isArray(retire) ? retire.filter((n) => names.includes(n)) : []);
  let msg = null;
  if (old?.msg && old.ch === ch.id) { try { msg = await ch.messages.edit(old.msg, payload); } catch { /* 消されていたら、新しく置く */ } }
  if (!msg) {
    if (old?.msg && old.ch !== ch.id) await (await chanOf(client, old.ch))?.messages.delete(old.msg).catch(() => {});
    msg = await ch.send({ ...payload, allowedMentions: { parse: [] } });
  }
  all[id] = { ch: ch.id, msg: msg.id, retire: retireNames, sticky: !!sticky, at: Date.now() }; setKV(g, KEY, all);
  await resyncGuildCommands(g);
  return all[id];
}
export async function removeCatPanel(client, g, id) {
  const all = catPanels(g), old = all[id]; if (!old) return false;
  await (await chanOf(client, old.ch))?.messages.delete(old.msg).catch(() => {});
  delete all[id]; setKV(g, KEY, all); await resyncGuildCommands(g); return true;
}
/** 専用のパネルができたカテゴリー(宝くじなど)の、古いカテゴリーパネルを、自動で撤去する(ダッシュボードの一覧から消えて、外せなくなるため)。メッセージも、消す */
export async function migrateCatPanels(client) {
  for (const g of client.guilds.cache.keys()) {
    try { for (const id of Object.keys(catPanels(g)).filter((x) => BUILTIN_CATEGORIES.has(x))) { await removeCatPanel(client, g, id); console.log(`[panels] ${g}: 古いカテゴリーパネル(${id})を撤去しました(専用のパネルがあります)`); } }
    catch (e) { console.warn(`[panels] 古いカテゴリーパネルの撤去に失敗 (${g}): ${e.message}`); }
  }
}
/** 「一番下に出す」の対象(サーバーごと) */
export const catStickItems = (client, g) => Object.keys(catPanels(g)).filter((id) => catById(id)).map((id, n) => ({ kind: `cat:${id}`, prio: 150 + n,
  state: (gg) => { const st = catPanels(gg)[id]; return st?.msg && st.sticky !== false ? { ch: st.ch, msg: st.msg } : null; },
  run: async (gg) => {
    const all = catPanels(gg), st = all[id], cat = catById(id); if (!st?.msg || st.sticky === false || !cat) return;
    const ch = (await chanOf(client, st.ch)); if (!ch?.isTextBased?.() || ch.lastMessageId === st.msg) return;
    await ch.messages.delete(st.msg).catch(() => {});
    const m = await ch.send({ ...catMessage(cat), allowedMentions: { parse: [] } }); all[id] = { ...st, msg: m.id, at: Date.now() }; setKV(gg, KEY, all);
  } }));

/**
 * ボタン・メニュー・入力欄の処理。customId:
 *   hub:b:<コマンド>:<サブ>                 コマンドのボタン
 *   hub:s:<コマンド>:<サブ>:<k>:<途中の答え>  k 番目の項目を答えるメニュー(選択肢・ユーザー)
 *   hub:m:<コマンド>:<サブ>:<途中の答え>      入力欄の送信
 * 途中の答えは、"." でつないだ文字(選択肢の番号・ユーザーID)
 */
export const hubComponent = {
  id: 'hub',
  async execute(i) {
    if (i.customId === 'hub:cancel') return closePrompt(i);
    const cancel = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hub:cancel').setLabel('キャンセル').setEmoji('❌').setStyle(ButtonStyle.Secondary));
    const [, kind, name, sub = '', kS = '', acc = ''] = i.customId.split(':'), say = (content, extra = {}) => i.reply({ content, ...EPH, ...extra });
    const cmd = findCommand(name), st = stepsOf(name, sub); if (!cmd || !st) return say(`/${name} は、もう使えません。`);
    const answers = (kind === 'b' ? '' : kind === 's' ? acc : kS).split('.').filter((x) => x !== '');
    const stepIdx = kind === 'b' ? 0 : kind === 's' ? Number(kS) + 1 : st.steps.length;   // いま答えて、次に聞くのは、何番目か
    if (kind === 's') answers[Number(kS)] = kind === 's' && st.steps[Number(kS)]?.t === 'user' ? (i.values?.[0] ?? '') : String(i.values?.[0]);
    // 「金額を入力…」を選んだ → 入力欄を出す
    if (kind === 's' && ['amount', 'qty'].includes(st.steps[Number(kS)]?.t) && listOf(st.steps[Number(kS)])[Number(answers[Number(kS)])]?.ask) {
      return i.showModal(new ModalBuilder().setCustomId(`hub:m:${name}:${sub}:${answers.join('.')}`).setTitle(labelOf(name, sub, name).label.slice(0, 45)).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel(st.steps[Number(kS)]?.t === 'qty' ? '個数' : '金額').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(12).setPlaceholder(st.steps[Number(kS)]?.t === 'qty' ? '例: 10' : '例: 1000'))));
    }
    // 次に聞くこと
    const next = st.steps[stepIdx];
    if (next && kind !== 'm') {
      const id = (k) => `hub:s:${name}:${sub}:${k}:${answers.join('.')}`;
      if (['pick', 'optpick', 'amount', 'qty'].includes(next.t)) {
        const o = next.o ?? { name: '金額', description: '金額' }, list = listOf(next);
        const body = { content: `${labelOf(name, sub, '').label}: ${next.t === 'amount' ? '金額' : next.t === 'qty' ? '個数' : (o.description || o.name)} を、選んでください。`, components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id(stepIdx)).setPlaceholder(String(o.description || o.name).slice(0, 100)).addOptions(list.slice(0, 25).map((c, n) => ({ label: String(c.name).slice(0, 100), value: String(n) })))), cancel()] };
        return kind === 'b' ? i.reply({ ...body, ...EPH }) : i.update(body);
      }
      if (next.t === 'user') {
        const body = { content: `${labelOf(name, sub, '').label}: ${next.o.description || next.o.name} を、選んでください。`, components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(id(stepIdx)).setPlaceholder(String(next.o.description || next.o.name).slice(0, 100)).setMinValues(1).setMaxValues(1)), cancel()] };
        return kind === 'b' ? i.reply({ ...body, ...EPH }) : i.update(body);
      }
      if (next.t === 'ask') {
        return i.showModal(new ModalBuilder().setCustomId(`hub:m:${name}:${sub}:${answers.join('.')}`).setTitle(labelOf(name, sub, name).label.slice(0, 45)).addComponents(...next.os.map((o) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(o.name).setLabel(String(o.name).slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(String(o.description ?? '').slice(0, 100))))));
      }
    }
    // 全部、聞いた → 値を集めて、実行する
    const values = {}; let ai = 0;
    for (const stp of st.steps) {
      if (['pick', 'optpick', 'amount', 'qty'].includes(stp.t)) {
        const c = listOf(stp)[Number(answers[ai++])]; if (!c) return say('その選択肢は、もう使えません。');
        if (c.values) Object.assign(values, c.values); else if (!c.skip && !c.ask) values[stp.o.name] = c.value;
        if (c.ask) { const r = parseValue(stp.o, i.fields?.getTextInputValue('amount')); if (r.error) return say(r.error); values[stp.o.name] = r.v; }
      }
      else if (stp.t === 'user') { const id = answers[ai++]; try { values[stp.o.name] = i.users?.get?.(id) ?? await i.client.users.fetch(id); } catch { return say('その人が、見つかりません。'); } }
      else if (stp.t === 'ask') for (const o of stp.os) { const r = parseValue(o, i.fields?.getTextInputValue(o.name)); if (r.error) return say(r.error); values[o.name] = r.v; }
    }
    i.__cmd = name; // どのコマンドを動かしたか(返事に、名前と残高を足すかの判断に使う)
    return cmd.execute(asCommand(i, values, sub || null));
  },
};
