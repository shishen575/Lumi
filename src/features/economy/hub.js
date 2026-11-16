import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { getKV, setKV } from '../../core/db.js';
import { commandCatalog, commandCategories, findCommand, registerHiddenCommands, registerHelpExtras, resyncGuildCommands } from '../../core/commands.js';
import { asCommand } from './panels.js';
import { schemaOf, parseValue } from './custompanels.js';

/**
 * メニューパネル: すべてのコマンドを、カテゴリーごとに、ボタンにして出す。
 * パネルには、カテゴリーを選ぶメニューだけを置く。選ぶと、本人にだけ、そのカテゴリーのコマンドのボタンが並ぶ。
 * ボタンを押すと、必要な項目(選択肢・ユーザー・数字など)を、順に聞いて、コマンドを実行する。
 */
const KEY = 'hub';
// メニューパネルには、出さないコマンド(通信の速さ・更新内容・ヘルプ・詳しい説明は、コマンドのまま使う。廃止もしない)
export const HUB_EXCLUDE = new Set(['ping', 'releasenotes', 'help', 'detail']);
const EPH = { flags: MessageFlags.Ephemeral };
export const hubState = (g) => getKV(g, KEY, null);
const link = (g, st) => `https://discord.com/channels/${g}/${st.ch}/${st.msg}`;
const cmdsOfCategories = (ids) => commandCategories().filter((c) => ids.includes(c.id)).flatMap((c) => c.commands).filter((n) => !HUB_EXCLUDE.has(n));
/** 廃止しているコマンド: 廃止すると決めたカテゴリーの、全部のコマンド(/help は、いつも残す) */
export const hubRetired = (st) => (st?.msg ? cmdsOfCategories(st.retire ?? []) : []);

registerHiddenCommands((g) => {
  const st = hubState(g), out = {};
  for (const name of hubRetired(st)) out[name] = `このサーバーでは、\`/${name}\` は廃止されました。メニューパネル(${link(g, st)})から使えます。`;
  return out;
});
registerHelpExtras((g) => { const st = hubState(g); return st?.msg ? [{ name: '📚 メニューパネル(全コマンド)', value: `[メニューパネル](${link(g, st)}) — <#${st.ch}>${hubRetired(st).length ? ` ・ 廃止: ${hubRetired(st).join(' ')}` : ''}` }] : []; });

/** 1つのコマンド(+サブコマンド)を、ボタンにできるか。できないときは、null。必要な項目を、聞く順番に並べて返す */
function stepsOf(name, sub) {
  const json = commandCatalog().find((c) => c.name === name); if (!json) return null;
  const sc = schemaOf(json, sub || null); if (sc.error) return null;
  const req = sc.options.filter((o) => o.required);
  if (req.some((o) => ![3, 4, 5, 6, 10].includes(o.type))) return null;          // チャンネル・ロール・ファイルが必須のものは、使えない
  if (req.filter((o) => o.type === 6).length > 1) return null;                   // ユーザーを2人以上は、聞けない
  const picks = req.filter((o) => (o.choices?.length || o.type === 5) && o.type !== 6), users = req.filter((o) => o.type === 6), asks = req.filter((o) => !o.choices?.length && o.type !== 5 && o.type !== 6);
  if (asks.length > 5) return null;
  return { json, sc, steps: [...picks.map((o) => ({ t: 'pick', o })), ...users.map((o) => ({ t: 'user', o })), ...(asks.length ? [{ t: 'ask', os: asks }] : [])] };
}
/** カテゴリーの、ボタンの一覧: [{ name, sub, label, desc }] */
export function buttonsOf(cat) {
  const out = [];
  for (const name of cat.commands.filter((n) => !HUB_EXCLUDE.has(n))) {
    const json = commandCatalog().find((c) => c.name === name); if (!json) continue;
    const subs = (json.options ?? []).filter((o) => o.type === 1);
    if (!subs.length) { if (stepsOf(name, null)) out.push({ name, sub: '', label: `/${name}`, desc: json.description }); continue; }
    for (const sc of subs) if (stepsOf(name, sc.name)) out.push({ name, sub: sc.name, label: `/${name} ${sc.name}`, desc: sc.description });
  }
  return out;
}

export function hubMessage(g) {
  const cats = commandCategories().filter((c) => buttonsOf(c).length);
  return {
    embeds: [new EmbedBuilder().setColor(0x6d5dfc).setTitle('📚 メニュー').setDescription('下のメニューで、カテゴリーを選ぶと、そのカテゴリーのコマンドが、ボタンで出ます(あなたにだけ見えます)。ボタンを押すと、必要なことを聞かれて、コマンドが動きます。')
      .addFields({ name: 'カテゴリー', value: cats.map((c) => `${c.emoji ?? '📁'} **${c.title}** — ${buttonsOf(c).length}個`).join('\n').slice(0, 1024) || '(ありません)' })],
    components: cats.length ? [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('hub:cat').setPlaceholder('カテゴリーを選ぶ').addOptions(cats.slice(0, 25).map((c) => ({ label: `${c.title}`.slice(0, 100), value: c.id, emoji: c.emoji ?? undefined, description: buttonsOf(c).slice(0, 4).map((b) => b.label).join(' ').slice(0, 100) }))))] : [],
  };
}

export async function installHub(client, g, channelId, retire, sticky = true) {
  const ch = client.channels.cache.get(channelId); if (!ch?.isTextBased?.() || ch.guildId !== g) throw new Error('チャンネルが不正です');
  const old = hubState(g), payload = hubMessage(g), valid = new Set(commandCategories().map((c) => c.id)), retireIds = (Array.isArray(retire) ? retire : []).filter((x) => valid.has(x));
  let msg = null;
  if (old?.msg && old.ch === ch.id) { try { msg = await ch.messages.edit(old.msg, payload); } catch { /* 消されていたら、新しく置く */ } }
  if (!msg) {
    if (old?.msg && old.ch !== ch.id) await client.channels.cache.get(old.ch)?.messages.delete(old.msg).catch(() => {});
    msg = await ch.send({ ...payload, allowedMentions: { parse: [] } });
  }
  setKV(g, KEY, { ch: ch.id, msg: msg.id, retire: retireIds, sticky: !!sticky, at: Date.now() });
  await resyncGuildCommands(g);
  return hubState(g);
}
export async function removeHub(client, g) {
  const old = hubState(g); if (!old) return false;
  await client.channels.cache.get(old.ch)?.messages.delete(old.msg).catch(() => {});
  setKV(g, KEY, null); await resyncGuildCommands(g); return true;
}
/** 「一番下に出す」の対象 */
export const hubStickItem = (client) => ({ kind: 'hub', prio: 90, state: (g) => { const st = hubState(g); return st?.msg && st.sticky !== false ? { ch: st.ch, msg: st.msg } : null; },
  run: async (g) => {
    const st = hubState(g); if (!st?.msg || st.sticky === false) return;
    const ch = client.channels.cache.get(st.ch); if (!ch?.isTextBased?.() || ch.lastMessageId === st.msg) return;
    await ch.messages.delete(st.msg).catch(() => {});
    const m = await ch.send({ ...hubMessage(g), allowedMentions: { parse: [] } }); setKV(g, KEY, { ...hubState(g), msg: m.id, at: Date.now() });
  } });

/**
 * ボタン・メニュー・入力欄の処理。customId:
 *   hub:cat                                カテゴリーを選ぶメニュー
 *   hub:b:<コマンド>:<サブ>                 コマンドのボタン
 *   hub:s:<コマンド>:<サブ>:<k>:<途中の答え>  k 番目の項目を答えるメニュー(選択肢・ユーザー)
 *   hub:m:<コマンド>:<サブ>:<途中の答え>      入力欄の送信
 * 途中の答えは、"." でつないだ文字(選択肢の番号・ユーザーID)
 */
export const hubComponent = {
  id: 'hub',
  async execute(i) {
    const [, kind, name, sub = '', kS = '', acc = ''] = i.customId.split(':'), say = (content, extra = {}) => i.reply({ content, ...EPH, ...extra });
    if (kind === 'cat') {
      const cat = commandCategories().find((c) => c.id === i.values?.[0]); if (!cat) return say('そのカテゴリーは、もうありません。パネルが古くなっています。');
      const bs = buttonsOf(cat).slice(0, 25), rows = [];
      for (let n = 0; n < bs.length; n += 5) rows.push(new ActionRowBuilder().addComponents(bs.slice(n, n + 5).map((b) => new ButtonBuilder().setCustomId(`hub:b:${b.name}:${b.sub}`).setLabel(b.label.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
      return say(`${cat.emoji ?? '📁'} **${cat.title}**\n${bs.map((b) => `\`${b.label}\` — ${b.desc}`).join('\n').slice(0, 1700)}`, { components: rows });
    }
    const cmd = findCommand(name), st = stepsOf(name, sub); if (!cmd || !st) return say(`/${name} は、もう使えません。`);
    const answers = (kind === 'b' ? '' : kind === 's' ? acc : kS).split('.').filter((x) => x !== '');
    const stepIdx = kind === 'b' ? 0 : kind === 's' ? Number(kS) + 1 : st.steps.length;   // いま答えて、次に聞くのは、何番目か
    if (kind === 's') answers[Number(kS)] = kind === 's' && st.steps[Number(kS)]?.t === 'user' ? (i.values?.[0] ?? '') : String(i.values?.[0]);
    // 次に聞くこと
    const next = st.steps[stepIdx];
    if (next && kind !== 'm') {
      const id = (k) => `hub:s:${name}:${sub}:${k}:${answers.join('.')}`;
      if (next.t === 'pick') {
        const o = next.o, list = o.type === 5 ? [{ name: 'オン', value: true }, { name: 'オフ', value: false }] : o.choices;
        const body = { content: `/${name}${sub ? ` ${sub}` : ''}: ${o.description || o.name} を、選んでください。`, components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(id(stepIdx)).setPlaceholder(String(o.description || o.name).slice(0, 100)).addOptions(list.slice(0, 25).map((c, n) => ({ label: String(c.name).slice(0, 100), value: String(n) }))))] };
        return kind === 'b' ? i.reply({ ...body, ...EPH }) : i.update(body);
      }
      if (next.t === 'user') {
        const body = { content: `/${name}${sub ? ` ${sub}` : ''}: ${next.o.description || next.o.name} を、選んでください。`, components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(id(stepIdx)).setPlaceholder(String(next.o.description || next.o.name).slice(0, 100)).setMinValues(1).setMaxValues(1))] };
        return kind === 'b' ? i.reply({ ...body, ...EPH }) : i.update(body);
      }
      if (next.t === 'ask') {
        return i.showModal(new ModalBuilder().setCustomId(`hub:m:${name}:${sub}:${answers.join('.')}`).setTitle(`/${name}${sub ? ` ${sub}` : ''}`.slice(0, 45)).addComponents(...next.os.map((o) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(o.name).setLabel(String(o.name).slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(String(o.description ?? '').slice(0, 100))))));
      }
    }
    // 全部、聞いた → 値を集めて、実行する
    const values = {}; let ai = 0;
    for (const stp of st.steps) {
      if (stp.t === 'pick') { const list = stp.o.type === 5 ? [{ value: true }, { value: false }] : stp.o.choices, c = list[Number(answers[ai++])]; if (!c) return say('その選択肢は、もう使えません。'); values[stp.o.name] = c.value; }
      else if (stp.t === 'user') { const id = answers[ai++]; try { values[stp.o.name] = i.users?.get?.(id) ?? await i.client.users.fetch(id); } catch { return say('その人が、見つかりません。'); } }
      else if (stp.t === 'ask') for (const o of stp.os) { const r = parseValue(o, i.fields?.getTextInputValue(o.name)); if (r.error) return say(r.error); values[o.name] = r.v; }
    }
    return cmd.execute(asCommand(i, values, sub || null));
  },
};
