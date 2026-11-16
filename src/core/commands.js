import { Events, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { isShuttingDown } from './shutdown.js';
import { noteInteraction } from './health.js';
import { hasAccessSync } from './access.js';

/**
 * サーバーごとに、使えなくするコマンド(例: パネルを設置したサーバーでは、元のコマンドを廃止する)。
 * 機能は provider を登録する: (guildId) => { コマンド名: 案内の文 }。登録・更新のたびに呼ばれ、載っているコマンドは、そのサーバーから外れる
 */
const hiddenProviders = [];
export const registerHiddenCommands = (fn) => hiddenProviders.push(fn);
const hiddenFor = (guildId) => Object.assign({}, ...hiddenProviders.map((f) => { try { return f(guildId) ?? {}; } catch { return {}; } }));
/**
 * 廃止されたコマンドの名前(`/market` など)が、返事の文に出てきたら、パネルへの案内に、置き換える(ボタンの結果に、使えないコマンドが出ないように)。
 * 文章・欄の値は、リンク([パネル](URL))にして、題名・欄の名前・フッターは、ただの「パネル」にする
 */
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function rewriteHidden(hid, payload) {
  const names = Object.keys(hid); if (!names.length || payload === null || payload === undefined) return payload;
  const alt = names.map(escRe).join('|'), re = new RegExp('`/(' + alt + ')(?: [^`]*)?`|(?<![\\w:./-])/(' + alt + ')(?![\\w-])', 'g');
  const link = (n) => String(hid[n]).match(/\((https:\/\/discord\.com\/channels\/[^)]+)\)/)?.[1];
  const sub = (str, rich) => (typeof str === 'string' ? str.replace(re, (m, a, b) => { const l = rich && link(a ?? b); return l ? `[パネル](${l})` : 'パネル'; }) : str);
  // リンクは長いので、置き換えたあとが、Discordの上限(本文2000・説明4096・欄の値1024・題名256・フッター2048・埋め込み全体6000)を超えるときは、リンクなしの「パネル」にする
  const fit = (str, rich, max) => { const r = sub(str, rich); return typeof r === 'string' && r.length > max ? sub(str, false) : r; };
  if (typeof payload === 'string') return fit(payload, true, 2000);
  if (typeof payload !== 'object') return payload;
  if (typeof payload.content === 'string') payload.content = fit(payload.content, true, 2000);
  for (const e of payload.embeds ?? []) {
    const d = e?.data ?? e; if (!d) continue;
    const orig = { title: d.title, description: d.description, footer: d.footer?.text, fields: (d.fields ?? []).map((f) => ({ name: f.name, value: f.value })) };
    const apply = (rich) => {
      d.title = fit(orig.title, false, 256); d.description = fit(orig.description, rich, 4096);
      if (d.footer?.text !== undefined) d.footer.text = fit(orig.footer, false, 2048);
      (d.fields ?? []).forEach((f, n) => { f.name = fit(orig.fields[n].name, false, 256); f.value = fit(orig.fields[n].value, rich, 1024); });
    };
    apply(true);
    const total = () => (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text?.length ?? 0) + (d.fields ?? []).reduce((x, f) => x + f.name.length + f.value.length, 0);
    if (total() > 5900) apply(false); // 埋め込み全体が、6000字に近いときは、リンクを全部やめる
  }
  return payload;
}

/** /help の「パネル」欄など、機能が、ヘルプに足す欄: (guildId) => [{ name, value }] */
const helpExtras = [];
export const registerHelpExtras = (fn) => helpExtras.push(fn);
let byNameRef = new Map(), catalogRef = [], categoriesRef = [];
/** 機能ごとの、コマンドの分類(メニューパネルで使う): [{ id, title, emoji, commands: [名前] }]。機能が categories を持っていなければ、機能ごとに1つ */
export const commandCategories = () => categoriesRef;
/** 登録されている全コマンドの、名前・説明・項目(カスタムパネルで、コマンドを選ぶのに使う) */
export const commandCatalog = () => catalogRef;
export const findCommand = (name) => byNameRef.get(name);
let resync = null;
/** そのサーバーのコマンドの登録を、やり直す(パネルの設置・撤去のあと) */
export const resyncGuildCommands = async (guildId) => { if (resync) await resync(guildId); };

/** サーバーごとの、登録済みコマンドのID(押せるコマンド表記 </名前:ID> を作るのに使う) */
const commandIds = new Map();
export const getCommandId = (guildId, name) => commandIds.get(guildId)?.get(name);

/**
 * 各機能の `commands: [{ data: SlashCommandBuilder, execute(interaction) }]` を集めて登録・実行する。
 * サーバー(ギルド)ごとに登録するので、変更がすぐ反映される。
 */
export function setupCommands(client, features) {
  const cmds = features.flatMap((f) => f.commands ?? []);
  if (!cmds.some((c) => c.data.name === 'help')) cmds.push(helpCommand(cmds, features)); // /help は自動生成
  if (!cmds.length) return;
  const byName = new Map(cmds.map((c) => [c.data.name, c]));
  byNameRef = byName; catalogRef = cmds.map((c) => c.data.toJSON());
  categoriesRef = features.flatMap((f) => (f.categories ?? [{ id: f.name, title: f.title ?? f.name, emoji: f.emoji ?? '📁', commands: (f.commands ?? []).map((c) => c.data.name) }]).map((c) => ({ ...c, commands: c.commands.filter((n) => byName.has(n)) }))).filter((c) => c.commands.length);
  const comps = features.flatMap((f) => f.components ?? []); // [{ id: 'ogiri:answer', execute(i) }]
  const body = cmds.map((c) => c.data.toJSON());
  const register = (guild) =>
    guild.commands.set(body.filter((b) => !(b.name in hiddenFor(guild.id))))
      .then((r) => {
        commandIds.set(guild.id, new Map([...r.values()].map((c) => [c.name, c.id])));
        console.log(`[commands] ${guild.name}: ${r.size} 個を登録しました`);
      })
      .catch((e) => console.error(`[commands] ${guild.name}: 登録失敗 (${e.code ?? ''}) ${e.message}` +
        (e.code === 50001 ? ' → このサーバーに applications.commands 付きで招待し直してください' : '')));

  resync = async (guildId) => { const g = client.guilds.cache.get(guildId); if (g) await register(g); };
  client.once(Events.ClientReady, () => {
    console.log(`[commands] ${client.guilds.cache.size} サーバーに登録します`);
    client.guilds.cache.forEach(register);
  });
  client.on(Events.GuildCreate, register);
  // コマンドとボタンの共通の実行: 遅延の計測、10062(3秒超過)の扱い、エラー時の応答
  async function run(label, i, fn) {
    const hid = i.guildId ? hiddenFor(i.guildId) : {}; // 廃止されたコマンドが、返事に出てきたら、パネルへの案内にする
    if (Object.keys(hid).length) for (const m of ['reply', 'editReply', 'followUp', 'update']) if (typeof i[m] === 'function') { const orig = i[m].bind(i); i[m] = (p, ...rest) => orig(rewriteHidden(hid, p), ...rest); }
    const t0 = Date.now();
    const lag = t0 - i.createdTimestamp; // 送られてから、BOTが処理を始めるまで
    noteInteraction({ lagMs: lag });
    try { await fn(i); }
    catch (e) {
      if (e.code === 10062) { // 3秒以内に応答できなかった。再試行しても無効なので、要点だけ記録する
        noteInteraction({ missed: true });
        console.warn(`[commands] ${label}: 3秒以内に応答できませんでした (受信まで ${lag}ms / 処理 ${Date.now() - t0}ms)`);
        return;
      }
      console.error(`[commands] ${label}:`, e);
      const msg = { content: 'エラーが発生しました。', flags: MessageFlags.Ephemeral };
      if (i.deferred || i.replied) await i.followUp(msg).catch(() => {}); else await i.reply(msg).catch(() => {});
    }
    if (lag > 1500 || Date.now() - t0 > 1500) {
      console.warn(`[commands] ${label} が遅れています (受信まで ${lag}ms / 処理 ${Date.now() - t0}ms)`);
    }
  }
  client.on(Events.InteractionCreate, (i) => {
    if (i.isAutocomplete?.()) { // 入力中の候補(コマンドの autocomplete 関数があるもの)
      const cmd = byName.get(i.commandName);
      if (cmd?.autocomplete) Promise.resolve(cmd.autocomplete(i)).catch((e) => { if (e.code !== 10062 && e.code !== 40060) console.warn(`[commands] autocomplete /${i.commandName}:`, e.message); });
      return;
    }
    if (i.isChatInputCommand()) {
      const cmd = byName.get(i.commandName);
      if (cmd && isShuttingDown()) return void i.reply({ content: '🔄 Lumi は、再起動の準備中です。数十秒後に、もう一度お試しください。', flags: MessageFlags.Ephemeral }).catch(() => {});
      const hidden = cmd && hiddenFor(i.guildId)[i.commandName]; // 廃止されたコマンド(古い表示が残っていた場合)
      if (hidden) return void i.reply({ content: hidden, flags: MessageFlags.Ephemeral }).catch(() => {});
      if (cmd) run(`/${i.commandName}`, i, (x) => cmd.execute(x));
    } else if (i.isButton() || i.isStringSelectMenu() || i.isUserSelectMenu() || i.isModalSubmit()) {
      const c = comps.find((x) => x.id === i.customId || i.customId.startsWith(`${x.id}:`));
      if (c) run(`button ${i.customId}`, i, (x) => c.execute(x));
    }
  });
  console.log(`[commands] ${cmds.length} 個のコマンドを登録します: ${[...byName.keys()].map((n) => '/' + n).join(' ')}`);
}

/** 登録済みコマンドと各機能の `help` 文から、ヘルプを自動生成する */
/** 欄(各1024字以内)を、Discordの上限(1つの埋め込みは合計6000字・25欄、1メッセージは埋め込み10個・合計6000字)に収まるように、メッセージごとに分ける */
export function packEmbeds(title, sections) {
  const batches = []; let cur = [], len = 0, n = 0;
  const flush = () => { if (cur.length) { batches.push(cur); cur = []; len = 0; n = 0; } };
  let emb = null;
  const newEmbed = () => { emb = new EmbedBuilder().setColor(0x6d5dfc).setTitle(batches.length || cur.length ? `${title}(続き)` : title); cur.push(emb); n = 0; len += emb.data.title.length; };
  for (const sec of sections) {
    const size = sec.name.length + sec.value.length;
    if (cur.length && len + size > 5500) { flush(); emb = null; }
    if (!emb || n >= 20) newEmbed();
    emb.addFields({ name: sec.name.slice(0, 256), value: sec.value.slice(0, 1024) }); n++; len += size;
  }
  flush();
  return batches.length ? batches : [[new EmbedBuilder().setColor(0x6d5dfc).setTitle(title).setDescription('(内容がありません)')]];
}

function helpCommand(cmds, features) {
  const all = [...cmds.map((c) => c.data), { name: 'help', description: 'このヘルプを表示します' }];
  // 機能が持つ「詳しい説明」(helpTopics)。/help topic:… で、その説明だけを全部表示する
  const topics = features.flatMap((f) => (f.helpTopics ?? []).map((t) => ({ ...t, feature: f }))).slice(0, 25);
  const builder = new SlashCommandBuilder().setName('help').setDescription('Lumiの使い方とコマンド一覧を表示します').setDMPermission(false)
    .addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけに表示)'));
  if (topics.length) builder.addStringOption((o) => o.setName('topic').setDescription('詳しい説明を見たい分野(省略すると、全体のヘルプ)')
    .addChoices(...topics.map((t) => ({ name: t.label, value: t.id }))));
  return {
    data: builder,
    async execute(i) {
      const topicId = i.options.getString?.('topic');
      const topic = topicId ? topics.find((t) => t.id === topicId) : null;
      if (topic) {
        const pub = i.options.getBoolean('public') ?? false;
        const batches = packEmbeds(topic.label, topic.sections({ guildId: i.guildId }));
        const opt = pub ? {} : { flags: MessageFlags.Ephemeral };
        await i.reply({ embeds: batches[0], ...opt });
        for (const b of batches.slice(1)) await i.followUp({ embeds: b, ...opt });
        return;
      }
      const embed = new EmbedBuilder().setColor(0x6d5dfc).setTitle('Lumi ヘルプ');
      // コマンドが増えても、Discordの上限(1フィールド1024字)を超えないよう、分けて出す
      const hid = hiddenFor(i.guildId); // 廃止されたコマンドは、載せない
      const isAdmin = hasAccessSync(i.guild, i.member, i.user.id); // 【管理者向け】のコマンドは、管理者にだけ、載せる
      const lines = [...new Map(all.map((d) => [d.name, d])).values()].filter((d) => !(d.name in hid) && (isAdmin || !String(d.description).startsWith('【管理者向け】'))).map((d) => `\`/${d.name}\` — ${d.description}`);
      let chunk = '', first = true;
      const pushChunk = () => { embed.addFields({ name: first ? 'コマンド一覧' : '\u200b', value: chunk }); first = false; chunk = ''; };
      for (const line of lines) { if (chunk && chunk.length + line.length + 1 > 1000) pushChunk(); chunk += (chunk ? '\n' : '') + line; }
      if (chunk) pushChunk();
      for (const f of features) if (f.help) embed.addFields({ name: f.title ?? f.name, value: f.help });
      for (const fn of helpExtras) { try { for (const fld of fn(i.guildId) ?? []) embed.addFields({ name: String(fld.name).slice(0, 256), value: String(fld.value).slice(0, 1024) }); } catch { /* 足せなくても、ヘルプは出す */ } }
      if (topics.length) embed.addFields({ name: '詳しい説明', value: '`/help` の `topic` で選べます:\n' + topics.map((tp) => `・${tp.label}`).join('\n') });
      const base = process.env.BASE_URL;
      const pub = i.options.getBoolean('public') ?? false;
      if (!pub && base && hasAccessSync(i.guild, i.member, i.user.id)) { // ダッシュボードを操作できる人にだけ案内(全員に表示するときは出さない)
        embed.addFields({ name: '設定(管理者向け)', value: `ダッシュボード: ${base.replace(/\/$/, '')}/dashboard/` });
      }
      await i.reply({ embeds: [embed], ...(pub ? {} : { flags: MessageFlags.Ephemeral }) }); // 既定は自分だけに表示
    },
  };
}
