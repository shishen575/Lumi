import { SlashCommandBuilder, MessageFlags, EmbedBuilder, Events, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getKV, setKV, migrate, db } from '../../core/db.js';
import { isOperator, canEditAccess } from '../../core/access.js';
import { chanOf } from '../../core/channels.js';
import { checkWord, botPick, toHira, isKana, tailOf, headOf, dictSize } from './game.js';

/**
 * しりとり: 人(ひとり、またはみんなで)と、BOTで、しりとりをする。
 *  ・`/shiritori start` で、始める(チャンネルごとに1つ)。言葉は、`/shiritori say` か、メッセージ(MESSAGE CONTENT INTENT が有効なとき)で送る
 *  ・BOTは、辞書の言葉で、返す。言葉が、なくなったら、BOTの負け。人は、「ん」・同じ言葉・時間切れで、負け
 */
const EPH = { flags: MessageFlags.Ephemeral };
const NO_MENTION = { parse: [] };
const BOT = '🤖 ルミ';
const LEVELS = { easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
export const DEFAULTS = { enabled: true, level: 'normal', timeSec: 60, messageMode: true, channelId: null };

migrate(`CREATE TABLE IF NOT EXISTS shiritori_stats (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id))`);
migrate(`CREATE TABLE IF NOT EXISTS shiritori_words (
  guild_id TEXT NOT NULL, word TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, word))`);
/** サーバーで、人が使った言葉を、数える(ランキング用) */
const bumpWord = (g, word) => db.prepare(`INSERT INTO shiritori_words (guild_id,word,uses,last_at) VALUES (?,?,1,?)
  ON CONFLICT(guild_id,word) DO UPDATE SET uses=uses+1, last_at=excluded.last_at`).run(g, word, Date.now());
export const topWords = (g, limit = 10) => db.prepare('SELECT word, uses FROM shiritori_words WHERE guild_id=? ORDER BY uses DESC, last_at DESC LIMIT ?').all(g, limit);
const wordsText = (rows) => rows.map((r, n) => `${['🥇', '🥈', '🥉'][n] ?? `${n + 1}.`} 「${r.word}」 — **${r.uses}回**`).join('\n') || 'まだ、記録がありません。';
const bump = (g, u, col, chain = 0) => db.prepare(`INSERT INTO shiritori_stats (guild_id,user_id,${col},best) VALUES (?,?,1,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET ${col}=${col}+1, best=MAX(best, excluded.best)`).run(g, u, chain);
const statsOf = (g, u) => db.prepare('SELECT wins, losses, best FROM shiritori_stats WHERE guild_id=? AND user_id=?').get(g, u) ?? { wins: 0, losses: 0, best: 0 };

/** ランキング: by = wins(勝ち数)/ best(最長の語数)/ rate(勝率。3戦以上) */
export const RANK_BY = { wins: '勝ち数', best: '最長の語数', rate: '勝率(3戦以上)' };
export function rankingRows(g, by = 'wins', limit = 10) {
  const order = { wins: 'wins DESC, best DESC, losses ASC', best: 'best DESC, wins DESC', rate: '(wins * 1.0 / (wins + losses)) DESC, wins DESC' }[by] ?? 'wins DESC';
  const where = by === 'rate' ? 'AND wins + losses >= 3' : by === 'wins' ? 'AND wins > 0' : 'AND best > 0';
  return db.prepare(`SELECT user_id, wins, losses, best FROM shiritori_stats WHERE guild_id=? ${where} ORDER BY ${order} LIMIT ?`).all(g, limit);
}
const rankLine = (r, n, by) => `${['🥇', '🥈', '🥉'][n] ?? `${n + 1}.`} <@${r.user_id}> — ${by === 'best' ? `**${r.best}語**(${r.wins}勝 ${r.losses}敗)` : by === 'rate' ? `**${Math.round(r.wins * 100 / (r.wins + r.losses))}%**(${r.wins}勝 ${r.losses}敗)` : `**${r.wins}勝** ${r.losses}敗(最長 ${r.best}語)`}`;
export function rankingEmbed(g, by = 'wins', uid = null) {
  const rows = rankingRows(g, by, 10), e = new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏆 しりとりランキング(${RANK_BY[by]})`)
    .setDescription(rows.length ? rows.map((r, n) => rankLine(r, n, by)).join('\n') : 'まだ、記録がありません。');
  e.addFields({ name: '📚 サーバーで、よく使われた言葉', value: wordsText(topWords(g, 5)) + '\n-# もっと見る: `/shiritori words`' });
  if (uid) { const all = rankingRows(g, by, 1000), pos = all.findIndex((r) => r.user_id === uid); if (pos >= 10) e.setFooter({ text: `あなたは ${pos + 1}位(${all.length}人中)` }); }
  return e;
}
const clampInt = (v, lo, hi, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
export const getSettings = (g) => ({ ...DEFAULTS, ...(getKV(g, 'shiritori_settings', {}) ?? {}) });
export function saveSettings(g, b) {
  const cur = getSettings(g), out = {
    enabled: b.enabled === undefined ? cur.enabled : !!b.enabled,
    level: b.level === undefined ? cur.level : (b.level in LEVELS ? b.level : DEFAULTS.level),
    timeSec: b.timeSec === undefined ? cur.timeSec : clampInt(b.timeSec, 10, 600, DEFAULTS.timeSec),
    messageMode: b.messageMode === undefined ? cur.messageMode : !!b.messageMode,
    channelId: b.channelId === undefined ? cur.channelId : (/^\d{15,25}$/.test(String(b.channelId ?? '')) ? String(b.channelId) : null),
  };
  setKV(g, 'shiritori_settings', out); return out;
}

/* ---------- ゲームの状態(サーバーごとに、チャンネルをキーにして、保存。再起動しても、続けられる) ---------- */
const loadAll = (g) => getKV(g, 'shiritori_games', {}) ?? {};
const saveAll = (g, all) => setKV(g, 'shiritori_games', all);
const getGame = (g, ch) => loadAll(g)[ch] ?? null;
const putGame = (g, ch, game) => { const all = loadAll(g); if (game) all[ch] = game; else delete all[ch]; saveAll(g, all); };
const chainOf = (game) => game.words.length;
const left = (game, now = Date.now()) => Math.max(0, Math.ceil((game.until - now) / 1000));

/** BOTが、最初に出す言葉(ランダムな、始めの文字から) */
function firstBotWord(level, rng = Math.random) {
  const heads = [...'あいうえおかきくけこさしすせそたちつてとなにはひふへほまみむめもやゆよらりれろわ'];
  for (let g = 0; g < 50; g++) { const w = botPick(heads[Math.floor(rng() * heads.length)], [], level, rng); if (w) return w; }
  return null;
}
/** チャンネルの、ボタン(押すと、その人だけの、プライベートスレッドができて、しりとりが始まる) */
export const panelMessage = () => ({
  embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('🔤 しりとり — ルミと勝負!').setDescription('下の「しりとりを始める」を押すと、**あなただけのプライベートスレッド**ができて、BOT(ルミ)と、しりとりで勝負できます。\nひらがな・カタカナで、言葉を書いて(`/shiritori say` でも、OK)。「ん」で終わる・同じ言葉・時間切れは、負けです。')],
  components: [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('shiritori:new').setLabel('しりとりを始める').setEmoji('🔤').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('shiritori:rank').setLabel('ランキング').setEmoji('🏆').setStyle(ButtonStyle.Secondary))],
});
const againRow = () => [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shiritori:again').setLabel('もう一度').setEmoji('🔁').setStyle(ButtonStyle.Success))];
const nextLine = (need, game) => `次は「**${need}**」から! ${game.mode === 'solo' ? '' : '(だれでも、答えられます) '}残り **${left(game)}秒**`;

/** ゲームを作る(first: bot = BOTが先 / me = 人が先)。thread = ボタンから作った、プライベートスレッドのゲーム */
function startGame(g, ch, uid, { level, mode = 'solo', first = 'bot', thread = false, rng = Math.random } = {}) {
  const st = getSettings(g), now = Date.now(), lv = level in LEVELS ? level : st.level;
  const nw = { starter: uid, mode, level: lv, timeSec: st.timeSec, words: [], need: null, until: now + st.timeSec * 1000, at: now, thread };
  if (first === 'bot') { const bw = firstBotWord(lv, rng); nw.words.push({ w: bw, by: 'bot' }); nw.need = tailOf(bw); }
  putGame(g, ch, nw);
  return nw;
}
const introText = (nw, uid, st) => [`🔤 **しりとり開始!** ${nw.mode === 'solo' ? `<@${uid}> さん と ${BOT}` : `みんな と ${BOT}`}の勝負です(強さ: ${LEVELS[nw.level]} ・ 1回の制限時間 ${nw.timeSec}秒)`,
  nw.words.length ? `${BOT}: **${nw.words[0].w}**\n${nextLine(nw.need, nw)}` : 'あなたから、どうぞ!(好きな言葉で、始められます)',
  `-# 言葉は、${st.messageMode ? 'そのまま、メッセージで書くか、' : ''}\`/shiritori say\` で送ります。「ん」で終わる・同じ言葉・時間切れは、負けです。ひらがな・カタカナだけ。`].join('\n');
/** ゲームを終える(戦績をつけて、状態を消す)。winners: 勝った人のID(BOTが勝ったときは、空) / losers: 負けた人のID */
function finish(g, ch, game, { winners = [], losers = [] }) {
  const chain = chainOf(game);
  for (const u of winners) bump(g, u, 'wins', chain);
  for (const u of losers) bump(g, u, 'losses', chain);
  putGame(g, ch, null);
}
const participants = (game) => [...new Set(game.words.filter((w) => w.by !== 'bot').map((w) => w.by))];

/**
 * 人の言葉を、1つ処理する。戻り値: null(無視) / { text, ended, invalid }
 * (メッセージのとき、関係のない発言を、無視できるように、isMessage を渡す)
 */
export function play(g, ch, uid, text, { isMessage = false, now = Date.now(), rng = Math.random } = {}) {
  const game = getGame(g, ch); if (!game) return null;
  if (game.mode === 'solo' && uid !== game.starter) return isMessage ? null : { text: 'これは、別の人のしりとりです。(みんなで遊ぶ方は、`/shiritori start mode:みんなで`)', invalid: true };
  const word = toHira(text);
  if (isMessage && (!isKana(word) || [...word].length < 2 || [...word].length > 30)) return null; // ふつうの会話は、無視する
  if (now > game.until) { // 時間切れ(人の負け)
    finish(g, ch, game, { losers: game.mode === 'solo' ? [game.starter] : [] });
    return { text: `⏰ 時間切れ! **${BOT}の勝ち!** (${chainOf(game)}語続きました)`, ended: true, again: !!game.thread };
  }
  const used = game.words.map((w) => w.w), r = checkWord(text, game.need, used);
  if (!r.ok) {
    if (!r.lose) return { text: `❌ ${r.why}`, invalid: true };
    finish(g, ch, game, { losers: game.mode === 'solo' ? [game.starter] : [uid] });
    return { text: `💥 ${r.why} **${BOT}の勝ち!** (${chainOf(game)}語続きました)`, ended: true, again: !!game.thread };
  }
  game.words.push({ w: r.word, by: uid }); bumpWord(g, r.word); // 使われた言葉を、数える
  const bw = botPick(r.tail, game.words.map((w) => w.w), game.level, rng);
  if (!bw) { // BOTが、返せない: 人の勝ち
    const win = game.mode === 'solo' ? [game.starter] : participants(game);
    finish(g, ch, game, { winners: win });
    return { text: `✅ 「${r.word}」\n🏳️ ${BOT}: 「**${r.tail}**」から始まる言葉が、思いつきません…参りました! **あなたたちの勝ち!** (${chainOf(game)}語続きました)`, ended: true, again: !!game.thread };
  }
  game.words.push({ w: bw, by: 'bot' }); game.need = tailOf(bw); game.until = now + game.timeSec * 1000;
  if (game.words.length > 2000) game.words = game.words.slice(-1000);
  putGame(g, ch, game);
  return { text: `✅ 「${r.word}」 → ${BOT}: **${bw}**\n${nextLine(game.need, game)}・${chainOf(game)}語目` };
}

/* ---------- コマンド ---------- */
const canStop = (i, game) => isOperator(i.user.id) || i.user.id === game.starter || i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
export const shiritoriCommand = {
  data: new SlashCommandBuilder().setName('shiritori').setDescription('しりとりで、BOTと勝負します').setDMPermission(false)
    .addSubcommand((c) => c.setName('start').setDescription('しりとりを、始めます(チャンネルごとに1つ)')
      .addStringOption((o) => o.setName('level').setDescription('ルミの強さ').addChoices(...Object.entries(LEVELS).map(([value, name]) => ({ name, value }))))
      .addStringOption((o) => o.setName('mode').setDescription('遊び方').addChoices({ name: '自分ひとりで、ルミと勝負', value: 'solo' }, { name: 'みんなで、ルミと勝負', value: 'team' }))
      .addStringOption((o) => o.setName('first').setDescription('どちらが先か').addChoices({ name: 'ルミが先(既定)', value: 'bot' }, { name: '自分が先', value: 'me' })))
    .addSubcommand((c) => c.setName('say').setDescription('言葉を、送ります(メッセージで送れるときは、そのまま書いても、OK)').addStringOption((o) => o.setName('word').setDescription('ひらがな・カタカナの言葉').setRequired(true).setMaxLength(40)))
    .addSubcommand((c) => c.setName('status').setDescription('いまの、しりとりの様子を見ます'))
    .addSubcommand((c) => c.setName('stop').setDescription('しりとりを、やめます(始めた人・管理者)'))
    .addSubcommand((c) => c.setName('ranking').setDescription('ランキングを見ます(勝ち数・最長・勝率)').addStringOption((o) => o.setName('by').setDescription('並べ方(省略すると、勝ち数)').addChoices(...Object.entries(RANK_BY).map(([value, name]) => ({ name, value })))))
    .addSubcommand((c) => c.setName('words').setDescription('サーバーで、いちばん使われた言葉を見ます'))
    .addSubcommand((c) => c.setName('panel').setDescription('【管理者向け】このチャンネルに、「しりとりを始める」のボタンを置きます'))
    .addSubcommand((c) => c.setName('stats').setDescription('戦績と、ランキングを見ます').addUserOption((o) => o.setName('user').setDescription('見たい人(省略すると、自分)'))),
  async execute(i, rng = Math.random) {
    const g = i.guildId, ch = i.channelId, sub = i.options.getSubcommand(), st = getSettings(g);
    if (sub === 'ranking') return i.reply({ embeds: [rankingEmbed(g, i.options.getString('by') ?? 'wins', i.user.id)], allowedMentions: NO_MENTION });
    if (sub === 'words') return i.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('📚 いちばん使われた言葉').setDescription(wordsText(topWords(g, 15))).setFooter({ text: 'このサーバーで、人が使った言葉(BOTの言葉は、数えません)' })], allowedMentions: NO_MENTION });
    if (sub === 'panel') {
      if (!(isOperator(i.user.id) || i.guild?.ownerId === i.user.id || i.memberPermissions?.has(PermissionFlagsBits.Administrator))) return i.reply({ content: 'ボタンを置けるのは、サーバーのオーナー・管理者だけです。', ...EPH });
      try { await installPanel(i.client, g, ch); } catch (e) { return i.reply({ content: `置けませんでした: ${e.message}`, ...EPH }); }
      return i.reply({ content: '✅ このチャンネルに、「しりとりを始める」のボタンを置きました。', ...EPH });
    }
    if (sub === 'stats') {
      const u = i.options.getUser('user') ?? i.user, me = statsOf(g, u.id);
      const top = db.prepare('SELECT user_id, wins, losses, best FROM shiritori_stats WHERE guild_id=? ORDER BY wins DESC, best DESC LIMIT 5').all(g);
      const e = new EmbedBuilder().setColor(0x57f287).setTitle('🔤 しりとりの戦績').setAuthor({ name: u.username, iconURL: u.displayAvatarURL?.() })
        .setDescription(`**${me.wins}勝 ${me.losses}敗** ・ 最長 **${me.best}語**`)
        .addFields({ name: '🏆 勝ち数ランキング', value: top.length ? top.map((r, n) => `${n + 1}. <@${r.user_id}> — ${r.wins}勝 ${r.losses}敗(最長 ${r.best}語)`).join('\n') : 'まだ、記録がありません' });
      return i.reply({ embeds: [e], allowedMentions: NO_MENTION });
    }
    if (!st.enabled) return i.reply({ content: 'このサーバーでは、しりとりはオフです。管理者が、ダッシュボードでオンにできます。', ...EPH });
    if (st.channelId && ch !== st.channelId && i.channel?.parentId !== st.channelId) return i.reply({ content: `しりとりは、<#${st.channelId}> で遊んでください。`, ...EPH });
    const game = getGame(g, ch);
    if (sub === 'start') {
      if (game) return i.reply({ content: `このチャンネルでは、もう、しりとりをしています。(\`/shiritori status\` で見られます。やめるときは \`/shiritori stop\`)`, ...EPH });
      const nw = startGame(g, ch, i.user.id, { level: i.options.getString('level') ?? st.level, mode: i.options.getString('mode') ?? 'solo', first: i.options.getString('first') ?? 'bot', rng });
      return i.reply({ content: introText(nw, i.user.id, st), allowedMentions: NO_MENTION });
    }
    if (!game) return i.reply({ content: 'このチャンネルでは、しりとりをしていません。`/shiritori start` で、始められます。', ...EPH });
    if (sub === 'status') {
      const e = new EmbedBuilder().setColor(0x57f287).setTitle('🔤 しりとり').setDescription(`${game.mode === 'solo' ? `<@${game.starter}> さん と ${BOT}` : `みんな と ${BOT}`} ・ 強さ ${LEVELS[game.level]}\n${chainOf(game)}語 続いています\n${game.need ? nextLine(game.need, game) : 'あなたから、どうぞ!'}`)
        .addFields({ name: '最近の言葉', value: game.words.slice(-10).map((w) => `${w.by === 'bot' ? '🤖' : '🙂'} ${w.w}`).join(' → ') || 'まだ、ありません' });
      return i.reply({ embeds: [e], allowedMentions: NO_MENTION });
    }
    if (sub === 'stop') {
      if (!canStop(i, game)) return i.reply({ content: 'やめられるのは、始めた人と、管理者だけです。', ...EPH });
      putGame(g, ch, null);
      return i.reply({ content: `🛑 しりとりを、やめました。(${chainOf(game)}語 続きました。勝ち負けは、つきません)`, allowedMentions: NO_MENTION });
    }
    // say
    const r = play(g, ch, i.user.id, i.options.getString('word', true), { rng });
    if (!r) return i.reply({ content: 'このチャンネルでは、しりとりをしていません。', ...EPH });
    return i.reply({ content: r.text, allowedMentions: NO_MENTION, ...(r.again ? { components: againRow() } : {}), ...(r.invalid ? EPH : {}) });
  },
};

/* ---------- ボタンのパネル ---------- */
const panelOf = (g) => getKV(g, 'shiritori_panel', null);
export async function installPanel(client, g, channelId) {
  const ch = await chanOf(client, channelId); if (!ch?.isTextBased?.() || ch.isThread?.() || ch.guildId !== g) throw new Error('文字のチャンネルを、選んでください(スレッドには、置けません)');
  const old = panelOf(g);
  if (old?.msg) await (await chanOf(client, old.ch))?.messages?.delete(old.msg).catch(() => {});
  const m = await ch.send({ ...panelMessage(), allowedMentions: NO_MENTION });
  setKV(g, 'shiritori_panel', { ch: ch.id, msg: m.id }); return { ch: ch.id, msg: m.id };
}
export async function removePanel(client, g) {
  const old = panelOf(g); if (!old) return false;
  await (await chanOf(client, old.ch))?.messages?.delete(old.msg).catch(() => {}); setKV(g, 'shiritori_panel', null); return true;
}
const activeOf = (g, uid) => Object.entries(loadAll(g)).find(([, gm]) => gm.thread && gm.starter === uid);

/** ボタン: しりとりを始める(プライベートスレッドを作る)/ ランキング / もう一度 */
export const shiritoriButton = {
  id: 'shiritori',
  async execute(i) {
    const action = i.customId.split(':')[1], g = i.guildId, st = getSettings(g);
    if (action === 'rank') return i.reply({ embeds: [rankingEmbed(g, 'wins', i.user.id)], allowedMentions: NO_MENTION, ...EPH });
    if (!st.enabled) return i.reply({ content: 'このサーバーでは、しりとりはオフです。', ...EPH });
    if (action === 'again') { // 同じスレッドで、もう一度(始めた人だけ)
      const old = getGame(g, i.channelId);
      if (old) return i.reply({ content: 'まだ、しりとりの途中です。', ...EPH });
      const nw = startGame(g, i.channelId, i.user.id, { level: st.level, mode: 'solo', first: 'bot', thread: true });
      return i.reply({ content: introText(nw, i.user.id, st), allowedMentions: NO_MENTION });
    }
    // new: プライベートスレッドを作って、その人だけで、始める
    const had = activeOf(g, i.user.id);
    if (had) return i.reply({ content: `もう、しりとりをしています: <#${had[0]}>`, ...EPH });
    const ch = i.channel;
    if (!ch?.threads || ch.isThread?.()) return i.reply({ content: 'ここでは、スレッドを作れません。', ...EPH });
    await i.deferReply(EPH);
    try {
      const name = `しりとり: ${i.member?.displayName ?? i.user.username}`.replace(/[\r\n]/g, ' ').slice(0, 100);
      const th = await ch.threads.create({ name, type: ChannelType.PrivateThread, invitable: false, autoArchiveDuration: 60, reason: 'しりとり' });
      await th.members.add(i.user.id);
      const nw = startGame(g, th.id, i.user.id, { level: st.level, mode: 'solo', first: 'bot', thread: true });
      await th.send({ content: introText(nw, i.user.id, st), allowedMentions: { users: [i.user.id] } });
      return i.editReply({ content: `🔤 あなただけのスレッドを作りました: <#${th.id}>` });
    } catch (e) {
      console.warn('[shiritori] スレッドを作れませんでした:', e.message);
      return i.editReply({ content: 'スレッドを作れませんでした。BOTに、**プライベートスレッドの作成**と、**スレッドでの発言**の権限が、あるか、確認してください。' });
    }
  },
};

export default {
  name: 'shiritori',
  title: 'しりとり',
  ui: '/dashboard/features/shiritori.js',
  commands: [shiritoriCommand],
  components: [shiritoriButton],
  help: [
    '`/shiritori start` で、BOTと、しりとりができます(ひとりで / みんなで。強さは、3段階)。',
    '言葉は、`/shiritori say` で送ります。メッセージで送れるサーバー(管理者が設定)では、そのまま、ひらがなで書いても、OKです。',
    '「ん」で終わる・同じ言葉・時間切れは負け。BOTが言葉に詰まったら、あなたの勝ち。',
    '`/shiritori ranking` で、ランキング(勝ち数・最長・勝率)、`/shiritori words` で、サーバーでいちばん使われた言葉、`/shiritori stats` で、自分の戦績を見られます。',
    '管理者が、チャンネルに「しりとりを始める」のボタンを置くと(`/shiritori panel`)、押した人だけの、プライベートスレッドで、遊べます。',
  ].join('\n'),

  register({ client, router }) {
    router.get('/settings', (req, res) => res.json({ ...getSettings(req.guild.id), levels: LEVELS, words: dictSize(), intent: client.options.intents.has('MessageContent') }));
    router.put('/settings', (req, res) => {
      if (!canEditAccess(req.access)) return res.status(403).json({ error: '変えられるのは、サーバーのオーナー・管理者・運営だけです' });
      res.json({ ...saveSettings(req.guild.id, req.body ?? {}), levels: LEVELS, words: dictSize() });
    });

    // ランキング(ダッシュボード用): 名前つき
    const nameOf = async (g, id) => { const m = req_guild(g)?.members?.cache?.get(id) ?? await req_guild(g)?.members?.fetch?.(id).catch(() => null); return m?.displayName ?? client.users.cache.get(id)?.username ?? '(不明)'; };
    const req_guild = (g) => client.guilds.cache.get(g);
    router.get('/ranking', async (req, res) => {
      const g = req.guild.id, by = req.query.by in RANK_BY ? req.query.by : 'wins';
      const players = await Promise.all(rankingRows(g, by, 20).map(async (r) => ({ ...r, name: await nameOf(g, r.user_id) })));
      res.json({ by, ranks: RANK_BY, players, words: topWords(g, 20) });
    });
    router.get('/panel', (req, res) => { const p = panelOf(req.guild.id); res.json(p ? { channel_id: p.ch, link: `https://discord.com/channels/${req.guild.id}/${p.ch}/${p.msg}` } : null); });
    router.post('/panel', async (req, res) => {
      if (!canEditAccess(req.access)) return res.status(403).json({ error: '置けるのは、サーバーのオーナー・管理者・運営だけです' });
      try { const p = await installPanel(client, req.guild.id, String(req.body?.channel_id ?? '')); res.json({ channel_id: p.ch, link: `https://discord.com/channels/${req.guild.id}/${p.ch}/${p.msg}` }); } catch (e) { res.status(400).json({ error: e.message }); }
    });
    router.delete('/panel', async (req, res) => {
      if (!canEditAccess(req.access)) return res.status(403).json({ error: '外せるのは、サーバーのオーナー・管理者・運営だけです' });
      res.json({ removed: await removePanel(client, req.guild.id) });
    });

    // メッセージで、言葉を送る(MESSAGE CONTENT INTENT が、有効なときだけ、本文が読める)
    client.on(Events.MessageCreate, async (msg) => {
      try {
        if (!msg.guildId || msg.author.bot || msg.webhookId || !msg.content) return;
        const g = msg.guildId, st = getSettings(g);
        if (!st.enabled || !st.messageMode || !getGame(g, msg.channelId)) return;
        const r = play(g, msg.channelId, msg.author.id, msg.content, { isMessage: true });
        if (!r) return;
        await msg.reply({ content: r.text, allowedMentions: { parse: [], repliedUser: false }, ...(r.again ? { components: againRow() } : {}) });
      } catch (e) { console.warn('[shiritori] メッセージの処理に失敗:', e.message); }
    });

    // 時間切れの掃除(15秒ごと): 人が、時間内に答えなかったら、BOTの勝ち
    const sweep = async () => {
      const now = Date.now();
      for (const g of client.guilds.cache.keys()) {
        let all; try { all = loadAll(g); } catch { continue; }
        for (const [ch, game] of Object.entries(all)) {
          if (now <= game.until + 1000) continue;
          finish(g, ch, game, { losers: game.mode === 'solo' ? [game.starter] : [] });
          const c = await chanOf(client, ch);
          c?.send?.({ content: `⏰ 時間切れ! **${BOT}の勝ち!** (${chainOf(game)}語続きました)`, allowedMentions: NO_MENTION, ...(game.thread ? { components: againRow() } : {}) }).catch(() => {});
        }
      }
    };
    const t = setInterval(() => sweep().catch((e) => console.warn('[shiritori] 掃除に失敗:', e.message)), 15_000); t.unref?.();
  },
};
