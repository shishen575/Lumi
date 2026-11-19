import { hasAccessSync } from '../../core/access.js';
import { StringSelectMenuBuilder, SlashCommandBuilder, MessageFlags, EmbedBuilder, Events, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } from 'discord.js';
import { getKV, setKV, migrate, db } from '../../core/db.js';
import { isOperator, canEditAccess } from '../../core/access.js';
import { chanOf } from '../../core/channels.js';
import { registerButtonOverride } from '../../core/commands.js';
import { resolveWord } from './dict.js';
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
export const DEFAULTS = { enabled: true, pvpChannelIds: [], pvpTimeSec: 600, deliberation: false, deliberationVotes: 3, deliberationSec: 300, allowSpectate: true, level: 'normal', timeSec: 60, messageMode: true, channelId: null, wordCheck: true, appealChannelId: null };

migrate(`CREATE TABLE IF NOT EXISTS shiritori_stats (
  guild_id TEXT NOT NULL, user_id TEXT NOT NULL, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id))`);
migrate(`CREATE TABLE IF NOT EXISTS shiritori_words (
  guild_id TEXT NOT NULL, word TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, word))`);
/** サーバーで、人が使った言葉を、数える(ランキング用) */
migrate(`CREATE TABLE IF NOT EXISTS shiritori_appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, word TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER, ch_id TEXT, msg_id TEXT)`);
migrate('CREATE INDEX IF NOT EXISTS shiritori_appeals_g ON shiritori_appeals (guild_id, status)');
const MAX_PENDING_PER_USER = 5;
/** 運営が、登録した言葉(辞書にない言葉を、通す) */
export const approvedWords = (g) => new Set(db.prepare("SELECT word FROM shiritori_appeals WHERE guild_id=? AND status='approved'").all(g).map((r) => r.word));
export function createAppeal(g, word, uid) {
  if (approvedWords(g).has(word)) return { error: 'approved' };
  if (db.prepare("SELECT 1 FROM shiritori_appeals WHERE guild_id=? AND word=? AND status='pending'").get(g, word)) return { error: 'pending' };
  if (db.prepare("SELECT COUNT(*) c FROM shiritori_appeals WHERE guild_id=? AND user_id=? AND status='pending'").get(g, uid).c >= MAX_PENDING_PER_USER) return { error: 'limit' };
  const r = db.prepare('INSERT INTO shiritori_appeals (guild_id, word, user_id, created_at) VALUES (?,?,?,?)').run(g, word, uid, Date.now());
  return { id: Number(r.lastInsertRowid) };
}
export const getAppeal = (g, id) => db.prepare('SELECT * FROM shiritori_appeals WHERE guild_id=? AND id=?').get(g, id) ?? null;
export const listAppeals = (g, statuses, limit = 50) => db.prepare(`SELECT * FROM shiritori_appeals WHERE guild_id=? AND status IN (${statuses.map(() => '?').join(',')}) ORDER BY id DESC LIMIT ?`).all(g, ...statuses, limit);
/** 運営の決定: approved(登録する)/ rejected(却下)/ removed(登録を、取り消す)。pending の ものだけ決められる(取り消しは、approved から) */
export function decideAppeal(g, id, decision, by) {
  const a = getAppeal(g, id); if (!a) return null;
  if (decision === 'removed' ? a.status !== 'approved' : a.status !== 'pending') return { error: 'done', appeal: a };
  db.prepare('UPDATE shiritori_appeals SET status=?, decided_by=?, decided_at=? WHERE id=?').run(decision, by, Date.now(), id);
  return { appeal: { ...a, status: decision, decided_by: by } };
}
const bumpWord = (g, word) => db.prepare(`INSERT INTO shiritori_words (guild_id,word,uses,last_at) VALUES (?,?,1,?)
  ON CONFLICT(guild_id,word) DO UPDATE SET uses=uses+1, last_at=excluded.last_at`).run(g, word, Date.now());
export const topWords = (g, limit = 10) => db.prepare('SELECT word, uses FROM shiritori_words WHERE guild_id=? ORDER BY uses DESC, last_at DESC LIMIT ?').all(g, limit);
const wordsText = (rows) => rows.map((r, n) => `${['🥇', '🥈', '🥉'][n] ?? `${n + 1}.`} 「${r.word}」 — **${r.uses}回**`).join('\n') || 'まだ、記録がありません。';
if (!db.prepare("SELECT 1 FROM pragma_table_info('shiritori_stats') WHERE name='used'").get()) db.exec('ALTER TABLE shiritori_stats ADD COLUMN used INTEGER NOT NULL DEFAULT 0');
/** 使った言葉の数(人どうしの、しりとりで、数える) */
const bumpUsed = (g, u, n = 1) => db.prepare(`INSERT INTO shiritori_stats (guild_id,user_id,used) VALUES (?,?,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET used=MAX(0, used+?)`).run(g, u, Math.max(0, n), n);
const unbumpWord = (g, word) => db.prepare('UPDATE shiritori_words SET uses=MAX(0, uses-1) WHERE guild_id=? AND word=?').run(g, word);
const bump = (g, u, col, chain = 0) => db.prepare(`INSERT INTO shiritori_stats (guild_id,user_id,${col},best) VALUES (?,?,1,?)
  ON CONFLICT(guild_id,user_id) DO UPDATE SET ${col}=${col}+1, best=MAX(best, excluded.best)`).run(g, u, chain);
const statsOf = (g, u) => db.prepare('SELECT wins, losses, best FROM shiritori_stats WHERE guild_id=? AND user_id=?').get(g, u) ?? { wins: 0, losses: 0, best: 0 };

/** ランキング: by = wins(勝ち数)/ best(最長の語数)/ rate(勝率。3戦以上) */
export const RANK_BY = { wins: '勝ち数', best: '最長の語数', rate: '勝率(3戦以上)', used: '使った言葉の数(人どうし)' };
export function rankingRows(g, by = 'wins', limit = 10) {
  const order = { wins: 'wins DESC, best DESC, losses ASC', best: 'best DESC, wins DESC', rate: '(wins * 1.0 / (wins + losses)) DESC, wins DESC', used: 'used DESC, wins DESC' }[by] ?? 'wins DESC';
  const where = by === 'rate' ? 'AND wins + losses >= 3' : by === 'wins' ? 'AND wins > 0' : by === 'used' ? 'AND used > 0' : 'AND best > 0';
  return db.prepare(`SELECT user_id, wins, losses, best, used FROM shiritori_stats WHERE guild_id=? ${where} ORDER BY ${order} LIMIT ?`).all(g, limit);
}
const rankLine = (r, n, by) => `${['🥇', '🥈', '🥉'][n] ?? `${n + 1}.`} <@${r.user_id}> — ${by === 'used' ? `**${r.used}語**(${r.wins}勝 ${r.losses}敗)` : by === 'best' ? `**${r.best}語**(${r.wins}勝 ${r.losses}敗)` : by === 'rate' ? `**${Math.round(r.wins * 100 / (r.wins + r.losses))}%**(${r.wins}勝 ${r.losses}敗)` : `**${r.wins}勝** ${r.losses}敗(最長 ${r.best}語)`}`;
export function rankingEmbed(g, by = 'wins', uid = null) {
  const rows = rankingRows(g, by, 10), e = new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏆 しりとりランキング(${RANK_BY[by]})`)
    .setDescription(rows.length ? rows.map((r, n) => rankLine(r, n, by)).join('\n') : 'まだ、記録がありません。');
  e.addFields({ name: '📚 サーバーで、よく使われた言葉', value: wordsText(topWords(g, 5)) + '\n-# もっと見る: `/shiritori words`' });
  if (uid) { const all = rankingRows(g, by, 1000), pos = all.findIndex((r) => r.user_id === uid); if (pos >= 10) e.setFooter({ text: `あなたは ${pos + 1}位(${all.length}人中)` }); }
  return e;
}
/** 1人の戦績(勝ち負け・最長・順位)と、勝ち数ランキング上位 */
function statsEmbed(g, u) {
  const me = statsOf(g, u.id), top = db.prepare('SELECT user_id, wins, losses, best FROM shiritori_stats WHERE guild_id=? AND wins > 0 ORDER BY wins DESC, best DESC LIMIT 5').all(g);
  const pos = rankingRows(g, 'wins', 1000).findIndex((r) => r.user_id === u.id);
  return new EmbedBuilder().setColor(0x57f287).setTitle('🔤 しりとりの戦績').setAuthor({ name: u.username, iconURL: u.displayAvatarURL?.() })
    .setDescription(`**${me.wins}勝 ${me.losses}敗** ・ 最長 **${me.best}語**${pos >= 0 ? ` ・ 勝ち数 **${pos + 1}位**` : ''}`)
    .addFields({ name: '🏆 勝ち数ランキング', value: top.length ? top.map((r, n) => `${n + 1}. <@${r.user_id}> — ${r.wins}勝 ${r.losses}敗(最長 ${r.best}語)`).join('\n') : 'まだ、記録がありません' });
}
const clampInt = (v, lo, hi, def) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
export const getSettings = (g) => ({ ...DEFAULTS, ...(getKV(g, 'shiritori_settings', {}) ?? {}) });
export function saveSettings(g, b) {
  const cur = getSettings(g), out = {
    enabled: b.enabled === undefined ? cur.enabled : !!b.enabled,
    level: b.level === undefined ? cur.level : (b.level in LEVELS ? b.level : DEFAULTS.level),
    timeSec: b.timeSec === undefined ? cur.timeSec : clampInt(b.timeSec, 10, 600, DEFAULTS.timeSec),
    messageMode: b.messageMode === undefined ? cur.messageMode : !!b.messageMode,
    pvpChannelIds: b.pvpChannelIds === undefined ? cur.pvpChannelIds : [...new Set((Array.isArray(b.pvpChannelIds) ? b.pvpChannelIds : []).map(String).filter((x) => /^\d{15,25}$/.test(x)))].slice(0, 10),
    pvpTimeSec: b.pvpTimeSec === undefined ? cur.pvpTimeSec : clampInt(b.pvpTimeSec, 30, 86400, DEFAULTS.pvpTimeSec),
    deliberation: b.deliberation === undefined ? cur.deliberation : !!b.deliberation,
    deliberationVotes: b.deliberationVotes === undefined ? cur.deliberationVotes : clampInt(b.deliberationVotes, 1, 20, DEFAULTS.deliberationVotes),
    deliberationSec: b.deliberationSec === undefined ? cur.deliberationSec : clampInt(b.deliberationSec, 30, 3600, DEFAULTS.deliberationSec),
    allowSpectate: b.allowSpectate === undefined ? cur.allowSpectate : !!b.allowSpectate,
    wordCheck: b.wordCheck === undefined ? cur.wordCheck : !!b.wordCheck,
    appealChannelId: b.appealChannelId === undefined ? cur.appealChannelId : (/^\d{15,25}$/.test(String(b.appealChannelId ?? '')) ? String(b.appealChannelId) : null),
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
    new ButtonBuilder().setCustomId('shiritori:watch').setLabel('観戦する').setEmoji('👀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('shiritori:rank').setLabel('ランキング').setEmoji('🏆').setStyle(ButtonStyle.Secondary))],
});
const appealRow = (word) => [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`shiritori:appeal:${word}`.slice(0, 100)).setLabel('異議申し立て').setEmoji('📣').setStyle(ButtonStyle.Secondary))];
const againRow = () => [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shiritori:again').setLabel('もう一度').setEmoji('🔁').setStyle(ButtonStyle.Success))];
const nextLine = (need, game) => `次は「**${need}**」から! ${game.mode === 'solo' ? '' : '(だれでも、答えられます) '}残り **${left(game)}秒**`;

/* ---------- プライベートスレッドの記録(進行中/終了済みを、名前に出す。観戦の一覧に使う) ---------- */
let CLIENT = null;
const threadRecs = (g) => getKV(g, 'shiritori_threads', {}) ?? {};
function recordThread(g, id, patch) {
  const all = threadRecs(g); all[id] = { ...(all[id] ?? {}), ...patch };
  const ids = Object.keys(all); if (ids.length > 60) for (const k of ids.filter((x) => all[x].status === 'end').sort((a, b) => (all[a].endedAt ?? 0) - (all[b].endedAt ?? 0)).slice(0, ids.length - 60)) delete all[k]; // 古い、終わったものから、消す
  setKV(g, 'shiritori_threads', all); return all[id];
}
const threadName = (status, base) => `しりとり-${base}${status === 'on' ? '【進行中】' : '【終了済み】'}`.slice(0, 100); // しりとり-名前【進行中】 → 終わると、しりとり-名前【終了済み】
/** スレッドの名前を、変える(1つのスレッドで、10分に2回までの制限があるので、待たずに、失敗しても、気にしない) */
function renameThread(id, name) { chanOf(CLIENT, id).then((th) => th?.setName?.(name, 'しりとりの状態').catch(() => {})).catch(() => {}); }

/** ゲームを作る(first: bot = BOTが先 / me = 人が先)。thread = ボタンから作った、プライベートスレッドのゲーム */
function startGame(g, ch, uid, { level, mode = 'solo', first = 'bot', thread = false, base = '', renamed = true, plain = false, rng = Math.random } = {}) {
  const st = getSettings(g), now = Date.now(), lv = level in LEVELS ? level : st.level;
  const nw = { starter: uid, mode, level: lv, timeSec: st.timeSec, words: [], need: null, until: now + (mode === 'pvp' ? st.pvpTimeSec : st.timeSec) * 1000, at: now, thread, plain };
  if (first === 'bot' && mode !== 'pvp') { const bw = firstBotWord(lv, rng); nw.words.push({ w: bw, by: 'bot' }); nw.need = tailOf(bw); }
  putGame(g, ch, nw);
  if (thread) { const rec = recordThread(g, ch, { starter: uid, status: 'on', base: base || threadRecs(g)[ch]?.base || '', at: now }); if (renamed) renameThread(ch, threadName('on', rec.base)); }
  return nw;
}
const introText = (nw, uid, st) => nw.mode === 'pvp' ? [`🔤 **しりとり開始!(人どうしの勝負)** ${BOT}は、審判です。`,
  '順番に、言葉をつなぎます(**同じ人が、続けて2回は、できません**)。最初の言葉は、どうぞ!',
  `-# 言葉は、メッセージで書きます(ひらがな・カタカナ${nw.plain ? '・漢字' : ''})。✅ = OK、❌ = だめ。「ん」で終わる・同じ言葉は、その人の負け。${st.deliberation ? `⚖️ のリアクションで、「審議」を、始められます(最新の言葉だけ。${st.deliberationVotes}票で、決まります)。` : ''}`].join('\n') : [`🔤 **しりとり開始!** ${nw.mode === 'solo' ? `<@${uid}> さん と ${BOT}` : `みんな と ${BOT}`}の勝負です(強さ: ${LEVELS[nw.level]} ・ 1回の制限時間 ${nw.timeSec}秒)`,
  nw.words.length ? `${BOT}: **${nw.words[0].w}**\n${nextLine(nw.need, nw)}` : 'あなたから、どうぞ!(好きな言葉で、始められます)',
  `-# 言葉は、${st.messageMode ? 'そのまま、メッセージで書くか、' : ''}\`/shiritori say\` で送ります。「ん」で終わる・同じ言葉・時間切れは、負けです。ひらがな・カタカナだけ。`].join('\n');
/** ゲームを終える(戦績をつけて、状態を消す)。winners: 勝った人のID(BOTが勝ったときは、空) / losers: 負けた人のID */
function finish(g, ch, game, { winners = [], losers = [] }) {
  const chain = chainOf(game);
  for (const u of winners) bump(g, u, 'wins', chain);
  for (const u of losers) bump(g, u, 'losses', chain);
  putGame(g, ch, null);
  if (game.thread) { const rec = recordThread(g, ch, { status: 'end', chain, endedAt: Date.now() }); renameThread(ch, threadName('end', rec.base ?? '')); }
}
/** 言葉の表示(漢字で書いたら、「林檎(りんご)」) */
const fmtWord = (word, surface) => (surface && toHira(surface) !== word ? `${surface}(${word})` : word);
const participants = (game) => [...new Set(game.words.filter((w) => w.by !== 'bot').map((w) => w.by))];

/**
 * 人の言葉を、1つ処理する。戻り値: null(無視) / { text, ended, invalid }
 * (メッセージのとき、関係のない発言を、無視できるように、isMessage を渡す)
 */
export async function play(g, ch, uid, text, { isMessage = false, now = Date.now(), rng = Math.random, msgId = null } = {}) {
  const game = getGame(g, ch); if (!game) return null;
  if (game.mode === 'pvp') return playPvp(g, ch, game, uid, text, { isMessage, now, msgId });
  if (game.mode === 'solo' && uid !== game.starter) return isMessage ? null : { text: 'これは、別の人のしりとりです。(みんなで遊ぶ方は、`/shiritori start mode:みんなで`)', invalid: true };
  const word = toHira(text);
  if (isMessage) { // メッセージ: ふつうの会話と、区別する。かな(2〜30文字)は、いつも。漢字まじりは、ひとりのプライベートスレッドでだけ(ふつうの会話と、区別がつかないため)
    const kanaWord = isKana(word) && [...word].length >= 2 && [...word].length <= 30;
    const kanjiWord = game.thread && /^[\u3041-\u3096\u30A1-\u30FAー\u4E00-\u9FFF々〆ヶ]{1,12}$/.test(String(text).normalize('NFKC').trim()) && /[\u4E00-\u9FFF々〆ヶ]/.test(String(text));
    if (!kanaWord && !kanjiWord) return null;
  }
  if (now > game.until) { // 時間切れ(人の負け)
    finish(g, ch, game, { losers: game.mode === 'solo' ? [game.starter] : [] });
    return { text: `⏰ 時間切れ! **${BOT}の勝ち!** (${chainOf(game)}語続きました)`, ended: true, again: !!game.thread };
  }
  const rw = await resolveWord(text, { check: getSettings(g).wordCheck, extra: approvedWords(g) }); // 辞書チェックと、漢字の読み取り
  if (!rw.ok) return isMessage && !isKana(word) ? null : { text: `❌ ${rw.why}`, invalid: true, appeal: rw.appeal }; // 漢字まじりのメッセージが、言葉でなかったら、ふつうの会話として、黙って、無視する
  const used = game.words.map((w) => w.w), r = checkWord(rw.reading, game.need, used);
  if (!r.ok) {
    if (!r.lose) return { text: `❌ ${r.why}`, invalid: true };
    finish(g, ch, game, { losers: game.mode === 'solo' ? [game.starter] : [uid] });
    return { text: `💥 ${r.why} **${BOT}の勝ち!** (${chainOf(game)}語続きました)`, ended: true, again: !!game.thread };
  }
  const shown = fmtWord(r.word, rw.surface);
  game.words.push({ w: r.word, by: uid, ...(shown !== r.word ? { disp: rw.surface } : {}) }); bumpWord(g, r.word); // 使われた言葉を、数える
  const bw = botPick(r.tail, game.words.map((w) => w.w), game.level, rng);
  if (!bw) { // BOTが、返せない: 人の勝ち
    const win = game.mode === 'solo' ? [game.starter] : participants(game);
    finish(g, ch, game, { winners: win });
    return { text: `✅ 「${shown}」\n🏳️ ${BOT}: 「**${r.tail}**」から始まる言葉が、思いつきません…参りました! **あなたたちの勝ち!** (${chainOf(game)}語続きました)`, ended: true, again: !!game.thread };
  }
  game.words.push({ w: bw, by: 'bot' }); game.need = tailOf(bw); game.until = now + game.timeSec * 1000;
  if (game.words.length > 2000) game.words = game.words.slice(-1000);
  putGame(g, ch, game);
  return { text: `✅ 「${shown}」 → ${BOT}: **${bw}**\n${nextLine(game.need, game)}・${chainOf(game)}語目` };
}

/* ---------- 人どうしの、しりとり(ルミは、審判) ---------- */
const looksLikeWord = (text, plain) => {
  const t = String(text ?? '').normalize('NFKC').trim(), h = toHira(t);
  if (isKana(h) && [...h].length >= 2 && [...h].length <= 30) return true;
  return !!plain && /^[\u3041-\u3096\u30A1-\u30FAー\u4E00-\u9FFF々〆ヶ]{1,12}$/.test(t) && /[\u4E00-\u9FFF々〆ヶ]/.test(t);
};
async function playPvp(g, ch, game, uid, text, { isMessage, now, msgId }) {
  const st = getSettings(g);
  if (isMessage && !looksLikeWord(text, game.plain)) return null; // ふつうの会話は、無視する
  if (now > game.until) { // しばらく、動きがなかった: 終わらせて、(常設のチャンネルなら)この言葉から、新しく始める
    finish(g, ch, game, {});
    if (!isPvpChannel(st, ch)) return { text: `⏰ しばらく動きがなかったので、しりとりを終わります。(${chainOf(game)}語続きました。勝ち負けは、つきません)`, ended: true };
    const nw = startGame(g, ch, uid, { mode: 'pvp', plain: game.plain }); return playPvp(g, ch, nw, uid, text, { isMessage, now, msgId });
  }
  const last = game.words.at(-1);
  if (last && last.by === uid) return { react: '🚫' }; // 続けて、2回は、できない
  if (game.dlb) return { react: '⏳' };                 // 審議中は、止まる
  const rw = await resolveWord(text, { check: st.wordCheck, extra: approvedWords(g) });
  if (!rw.ok) return isMessage && !isKana(toHira(text)) ? null : { react: '❌', text: `${rw.why}`, appeal: rw.appeal };
  const r = checkWord(rw.reading, game.need, game.words.map((w) => w.w));
  if (!r.ok) {
    if (!r.lose) return { react: '❌', text: r.why };
    const others = participants(game).filter((u) => u !== uid);
    finish(g, ch, game, { winners: others, losers: [uid] });
    return { react: '💥', text: `💥 ${r.why} <@${uid}> さんの負け!${others.length ? ` 勝ち: ${others.map((u) => `<@${u}>`).join(' ')}` : ''} (${chainOf(game)}語続きました)`, ended: true };
  }
  const shown = fmtWord(r.word, rw.surface);
  game.words.push({ w: r.word, by: uid, msg: msgId ?? undefined, ...(shown !== r.word ? { disp: rw.surface } : {}) });
  game.need = r.tail; game.until = now + st.pvpTimeSec * 1000;
  bumpWord(g, r.word); bumpUsed(g, uid);
  if (game.words.length > 2000) game.words = game.words.slice(-1000);
  putGame(g, ch, game);
  return { react: '✅', accepted: true, prevMsg: last?.msg, shown };
}
const isPvpChannel = (st, ch, parentId = null) => st.pvpChannelIds.includes(ch) || (parentId && st.pvpChannelIds.includes(parentId));

/** 過去の発言から、しりとりの言葉を、拾って、数える(最大3000件・古い順)。取り込みずみの所までは、二重に数えない */
export async function importHistory(client, g, ch, { maxMessages = 3000 } = {}) {
  const done = getKV(g, 'shiritori_imports', {}) ?? {}, after = done[ch.id] ? BigInt(done[ch.id]) : 0n;
  const all = []; let before;
  for (let page = 0; page < Math.ceil(maxMessages / 100); page++) {
    const batch = await ch.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    let stop = false; for (const m of batch.values()) { if (BigInt(m.id) <= after) { stop = true; continue; } all.push(m); }
    before = batch.last().id; if (stop || batch.size < 100) break;
  }
  all.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  let prev = null, words = 0; const seen = new Set(), players = new Set();
  for (const m of all) {
    if (m.author.bot || !m.content) continue;
    const t = toHira(m.content.trim());
    if (!isKana(t) || [...t].length < 2 || [...t].length > 30) continue; // ふつうの会話は、とばす
    if (prev && headOf(t) !== prev) continue;                         // つながっていない発言も、とばす
    if (seen.has(t)) continue;
    seen.add(t); bumpWord(g, t); bumpUsed(g, m.author.id); words++; players.add(m.author.id);
    const tail = tailOf(t); if (tail === 'ん') { prev = null; seen.clear(); } else prev = tail; // 「ん」で、1ゲームが終わって、また最初から
  }
  if (all.length) { done[ch.id] = String(all.at(-1).id); setKV(g, 'shiritori_imports', done); }
  return { scanned: all.length, words, players: players.size };
}

/* ---------- 審議(任意): 最新の言葉に、⚖️ をつけると、投票で、有効/無効を決める ---------- */
const dlbRow = () => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('shiritori:dlok').setLabel('有効').setEmoji('⭕').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('shiritori:dlng').setLabel('無効').setEmoji('❌').setStyle(ButtonStyle.Danger))];
const dlbCount = (d) => ({ ok: Object.values(d.votes).filter((v) => v === 'ok').length, ng: Object.values(d.votes).filter((v) => v === 'ng').length });
const dlbText = (game, st) => { const w = game.words.at(-1), c = dlbCount(game.dlb); return `⚖️ **審議** 「**${w.disp ?? w.w}**」(<@${w.by}> さんの言葉)は、有効?\n⭕ 有効 **${c.ok}** ・ ❌ 無効 **${c.ng}** ・ **${st.deliberationVotes}票**で、決まります(<t:${Math.floor(game.dlb.until / 1000)}:R> まで。時間切れは、票の多い方。同じなら、有効)\n-# 言葉を書いた人は、投票できません。運営(管理者)が押すと、その場で、決まります。`; };
/** 審議の結果を、反映する: 無効なら、その言葉を取り消して、1つ前に戻す */
async function settleDeliberation(client, g, ch, game, result, by = null) {
  const d = game.dlb, word = game.words.at(-1); game.dlb = null;
  const chan = await chanOf(client, ch);
  if (result === 'ng' && word) {
    game.words.pop(); unbumpWord(g, word.w); bumpUsed(g, word.by, -1);
    const prev = game.words.at(-1); game.need = prev ? tailOf(prev.w) : null; game.until = Date.now() + getSettings(g).pvpTimeSec * 1000;
    putGame(g, ch, game);
    if (word.msg) { const m = await chan?.messages?.fetch?.(word.msg).catch(() => null); m?.react?.('❌').catch(() => {}); }
    await chan?.send?.({ content: `⚖️ 審議の結果、「**${word.disp ?? word.w}**」は、**無効**になりました。${game.need ? `次は「**${game.need}**」から!` : '最初の言葉から、やり直しです。'}${by ? `(運営が、決めました)` : ''}`, allowedMentions: NO_MENTION }).catch(() => {});
  } else {
    if (word) word.locked = true; putGame(g, ch, game);
    await chan?.send?.({ content: `⚖️ 審議の結果、「**${word?.disp ?? word?.w}**」は、**有効**です。${by ? '(運営が、決めました)' : ''}`, allowedMentions: NO_MENTION }).catch(() => {});
  }
  if (d?.review) await chan?.messages?.edit?.(d.review, { components: [], allowedMentions: NO_MENTION }).catch(() => {});
  if (word) notifyStaff(client, g, ch, `⚖️ 審議の結果: 「**${word.disp ?? word.w}**」は、**${result === 'ng' ? '無効' : '有効'}**${by ? `(運営 <@${by}> が、決めました)` : ''}`).catch(() => {});
}
async function openDeliberation(client, g, ch, game, by) {
  const st = getSettings(g), now = Date.now();
  game.dlb = { by, votes: { [by]: 'ng' }, until: now + st.deliberationSec * 1000, review: null };
  const chan = await chanOf(client, ch);
  const m = await chan?.send?.({ content: dlbText(game, st), components: dlbRow(), allowedMentions: NO_MENTION }).catch(() => null);
  if (m) game.dlb.review = m.id;
  putGame(g, ch, game);
  const w = game.words.at(-1); notifyStaff(client, g, ch, `⚖️ **審議が始まりました** 「**${w.disp ?? w.w}**」(<@${w.by}> さんの言葉) — 申し立て: <@${by}> ・ ${m ? msgLink(g, ch, m.id) : `<#${ch}>`}\n-# 運営は、そのチャンネルの「有効/無効」ボタンで、その場で決められます`)
}
async function voteButton(i, vote) {
  const g = i.guildId, ch = i.channelId, game = getGame(g, ch), st = getSettings(g);
  if (!game?.dlb || game.mode !== 'pvp') return i.reply({ content: 'この審議は、もう、終わっています。', ...EPH });
  const word = game.words.at(-1);
  if (word?.by === i.user.id) return i.reply({ content: '自分の言葉の審議には、投票できません。', ...EPH });
  if (hasAccessSync(i.guild, i.member, i.user.id)) { await i.deferUpdate().catch(() => {}); return settleDeliberation(i.client, g, ch, game, vote, i.user.id); } // 運営は、その場で、決める
  game.dlb.votes[i.user.id] = vote; const c = dlbCount(game.dlb);
  if (c.ng >= st.deliberationVotes || c.ok >= st.deliberationVotes) { await i.deferUpdate().catch(() => {}); return settleDeliberation(i.client, g, ch, game, c.ng >= st.deliberationVotes ? 'ng' : 'ok'); }
  putGame(g, ch, game);
  return i.update({ content: dlbText(game, st), components: dlbRow(), allowedMentions: NO_MENTION });
}

/* ---------- コマンド ---------- */
/** 運営(OPERATOR_IDS)・オーナー・管理者・ダッシュボードで決めた管理ロールの人 */
const isStaff = (i) => hasAccessSync(i.guild, i.member, i.user.id) || !!i.memberPermissions?.has(PermissionFlagsBits.Administrator);
const canStop = (i, game) => isStaff(i) || i.user.id === game.starter || i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
export const shiritoriCommand = {
  data: new SlashCommandBuilder().setName('shiritori').setDescription('しりとりで、BOTと勝負します').setDMPermission(false)
    .addSubcommand((c) => c.setName('start').setDescription('しりとりを、始めます(チャンネルごとに1つ)')
      .addStringOption((o) => o.setName('level').setDescription('ルミの強さ').addChoices(...Object.entries(LEVELS).map(([value, name]) => ({ name, value }))))
      .addStringOption((o) => o.setName('mode').setDescription('遊び方').addChoices({ name: '自分ひとりで、ルミと勝負', value: 'solo' }, { name: 'みんなで、ルミと勝負', value: 'team' }, { name: '人どうしで勝負(ルミは審判)', value: 'pvp' }))
      .addStringOption((o) => o.setName('first').setDescription('どちらが先か').addChoices({ name: 'ルミが先(既定)', value: 'bot' }, { name: '自分が先', value: 'me' })))
    .addSubcommand((c) => c.setName('say').setDescription('言葉を、送ります(メッセージで送れるときは、そのまま書いても、OK)').addStringOption((o) => o.setName('word').setDescription('ひらがな・カタカナの言葉').setRequired(true).setMaxLength(40)))
    .addSubcommand((c) => c.setName('status').setDescription('いまの、しりとりの様子を見ます(自分だけに見えます)').addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('stop').setDescription('しりとりを、やめます(始めた人・管理者)'))
    .addSubcommand((c) => c.setName('watch').setDescription('ほかの人の、しりとりを、観戦します(進行中・終了済み)'))
    .addSubcommand((c) => c.setName('ranking').setDescription('ランキングを見ます(勝ち数・最長・勝率)').addStringOption((o) => o.setName('by').setDescription('並べ方(省略すると、勝ち数)').addChoices(...Object.entries(RANK_BY).map(([value, name]) => ({ name, value })))).addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('words').setDescription('サーバーで、いちばん使われた言葉を見ます').addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('import').setDescription('【管理者向け】チャンネル(スレッド)の、過去の発言から、しりとりの言葉を、ランキングに数えます')
      .addChannelOption((o) => o.setName('channel').setDescription('取り込むチャンネル・スレッド(省略すると、ここ)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)))
    .addSubcommand((c) => c.setName('panel').setDescription('【管理者向け】このチャンネルに、「しりとりを始める」のボタンを置きます'))
    .addSubcommand((c) => c.setName('stats').setDescription('戦績と、ランキングを見ます').addUserOption((o) => o.setName('user').setDescription('見たい人(省略すると、自分)')).addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)'))),
  async execute(i, rng = Math.random) {
    const g = i.guildId, ch = i.channelId, sub = i.options.getSubcommand(), st = getSettings(g);
    const vis = () => (i.options.getBoolean?.('public') ? {} : EPH); // 始める・やめる以外は、既定で、自分だけに見える(みんなに見せるなら、public)
    if (sub === 'watch') return watchList(i);
    if (sub === 'ranking') return i.reply({ embeds: [rankingEmbed(g, i.options.getString('by') ?? 'wins', i.user.id)], allowedMentions: NO_MENTION, ...vis() });
    if (sub === 'words') return i.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle('📚 いちばん使われた言葉').setDescription(wordsText(topWords(g, 15))).setFooter({ text: 'このサーバーで、人が使った言葉(BOTの言葉は、数えません)' })], allowedMentions: NO_MENTION, ...vis() });
    if (sub === 'import') {
      if (!isStaff(i)) return i.reply({ content: '取り込めるのは、運営・サーバーのオーナー・管理者だけです。', ...EPH });
      if (!i.client.options.intents.has('MessageContent')) return i.reply({ content: 'BOTがメッセージの本文を読めないため、取り込めません。(BOTの運営者が、MESSAGE CONTENT INTENT を有効にする必要があります)', ...EPH });
      const target = i.options.getChannel('channel') ?? i.channel, ch = await chanOf(i.client, target?.id);
      if (!ch?.messages || ch.guildId !== g) return i.reply({ content: 'そのチャンネルは、読めません。', ...EPH });
      await i.deferReply(EPH);
      try {
        const r = await importHistory(i.client, g, ch);
        return i.editReply({ content: r.scanned ? `✅ <#${ch.id}> の ${r.scanned}件の発言から、**${r.words}語**を数えました(${r.players}人)。\n-# つながっている、ひらがな・カタカナの発言だけを拾います。前に取り込んだ所までは、二重に数えません。` : `<#${ch.id}> に、新しく取り込める発言は、ありませんでした。(取り込みずみか、BOTが読めないチャンネルかもしれません)` });
      } catch (e) { console.warn('[shiritori] 取り込みに失敗:', e.message); return i.editReply({ content: `取り込めませんでした: ${e.message}(BOTに、そのチャンネルを読む権限が、あるか、確認してください)` }); }
    }
    if (sub === 'panel') {
      if (!isStaff(i)) return i.reply({ content: 'ボタンを置けるのは、運営・サーバーのオーナー・管理者だけです。', ...EPH });
      try { await installPanel(i.client, g, ch); } catch (e) { return i.reply({ content: `置けませんでした: ${e.message}`, ...EPH }); }
      return i.reply({ content: '✅ このチャンネルに、「しりとりを始める」のボタンを置きました。', ...EPH });
    }
    if (sub === 'stats') return i.reply({ embeds: [statsEmbed(g, i.options.getUser('user') ?? i.user)], allowedMentions: NO_MENTION, ...vis() });
    if (!st.enabled) return i.reply({ content: 'このサーバーでは、しりとりはオフです。管理者が、ダッシュボードでオンにできます。', ...EPH });
    if (st.channelId && ch !== st.channelId && i.channel?.parentId !== st.channelId) return i.reply({ content: `しりとりは、<#${st.channelId}> で遊んでください。`, ...EPH });
    const game = getGame(g, ch);
    if (sub === 'start') {
      if (game) return i.reply({ content: `このチャンネルでは、もう、しりとりをしています。(\`/shiritori status\` で見られます。やめるときは \`/shiritori stop\`)`, ...EPH });
      const nw = startGame(g, ch, i.user.id, { level: i.options.getString('level') ?? st.level, mode: i.options.getString('mode') ?? 'solo', first: i.options.getString('first') ?? 'bot', plain: !!i.channel?.isThread?.(), rng });
      return i.reply({ content: introText(nw, i.user.id, st), allowedMentions: NO_MENTION });
    }
    if (!game) return i.reply({ content: 'このチャンネルでは、しりとりをしていません。`/shiritori start` で、始められます。', ...EPH });
    if (sub === 'status') {
      const e = new EmbedBuilder().setColor(0x57f287).setTitle('🔤 しりとり').setDescription(`${game.mode === 'pvp' ? '人どうしの勝負(ルミは審判)' : game.mode === 'solo' ? `<@${game.starter}> さん と ${BOT}` : `みんな と ${BOT}`}${game.mode === 'pvp' ? '' : ` ・ 強さ ${LEVELS[game.level]}`}\n${chainOf(game)}語 続いています\n${game.need ? nextLine(game.need, game) : 'あなたから、どうぞ!'}`)
        .addFields({ name: '最近の言葉', value: game.words.slice(-10).map((w) => `${w.by === 'bot' ? '🤖' : '🙂'} ${w.disp ?? w.w}`).join(' → ') || 'まだ、ありません' });
      return i.reply({ embeds: [e], allowedMentions: NO_MENTION, ...vis() });
    }
    if (sub === 'stop') {
      if (!canStop(i, game)) return i.reply({ content: 'やめられるのは、始めた人と、管理者だけです。', ...EPH });
      putGame(g, ch, null);
      return i.reply({ content: `🛑 しりとりを、やめました。(${chainOf(game)}語 続きました。勝ち負けは、つきません)`, allowedMentions: NO_MENTION });
    }
    // say
    const solo = game.mode === 'solo'; // 終わると、ゲームの状態が消えるので、先に、覚えておく
    await i.deferReply(solo ? EPH : {}); // 辞書の読み込みで、少し、かかることがある
    const r = await play(g, ch, i.user.id, i.options.getString('word', true), { rng });
    if (!r) return i.editReply({ content: 'このチャンネルでは、しりとりをしていません。' });
    if (!r.text && r.react) r.text = { '🚫': '続けて、2回は、できません。ほかの人を、待ってください。', '⏳': '審議中です。決まるまで、待ってください。' }[r.react] ?? r.react;
    if (r.accepted) { const gm = getGame(g, ch); r.text = `✅ 「${r.shown}」 → 次は「**${gm?.need}**」から!`; } // 人どうし: ルミは、審判
    return i.editReply({ content: r.text, allowedMentions: NO_MENTION, ...(r.again ? { components: againRow() } : r.appeal ? { components: appealRow(r.appeal) } : {}) }); // 自分だけ/みんなに見えるかは、deferReply で、決めてある // ひとりの勝負は、自分だけに見える(みんなで遊ぶときは、みんなが、動きを見られるように、全員に見える)
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

/** プライベートスレッドを作って、その人だけで、しりとりを始める(ボタン・カテゴリーパネルの「始める」から) */
async function newThreadGame(i) {
  const g = i.guildId, st = getSettings(g);
  if (!st.enabled) return i.reply({ content: 'このサーバーでは、しりとりはオフです。', ...EPH });
  if (st.channelId && i.channelId !== st.channelId && i.channel?.parentId !== st.channelId) return i.reply({ content: `しりとりは、<#${st.channelId}> で遊んでください。`, ...EPH });
    const had = activeOf(g, i.user.id);
    if (had) return i.reply({ content: `もう、しりとりをしています: <#${had[0]}>`, ...EPH });
    const ch = i.channel;
    if (!ch?.threads || ch.isThread?.()) return i.reply({ content: 'ここでは、スレッドを作れません。', ...EPH });
    await i.deferReply(EPH);
    try {
      const base = String(i.member?.displayName ?? i.user.username).replace(/[\r\n]/g, ' ').slice(0, 40), name = threadName('on', base);
      const th = await ch.threads.create({ name, type: ChannelType.PrivateThread, invitable: true, autoArchiveDuration: 60, reason: 'しりとり' }); // invitable: 観戦に来た人を、BOTが追加できるように
      await th.members.add(i.user.id);
      const nw = startGame(g, th.id, i.user.id, { level: st.level, mode: 'solo', first: 'bot', thread: true, base, renamed: false }); // 作ったときの名前が、「進行中」
      await th.send({ content: introText(nw, i.user.id, st), allowedMentions: { users: [i.user.id] } });
      return i.editReply({ content: `🔤 あなただけのスレッドを作りました: <#${th.id}>` });
    } catch (e) {
      console.warn('[shiritori] スレッドを作れませんでした:', e.message);
      return i.editReply({ content: 'スレッドを作れませんでした。BOTに、**プライベートスレッドの作成**と、**スレッドでの発言**の権限が、あるか、確認してください。' });
    }
}

/* ---------- 異議申し立て(辞書で弾かれた言葉を、運営が、登録するか決める) ---------- */
const reviewRow = (id) => [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`shiritori:apok:${id}`).setLabel('登録する').setEmoji('✅').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`shiritori:apno:${id}`).setLabel('却下').setEmoji('❌').setStyle(ButtonStyle.Danger))];
const reviewText = (a, tail = '') => `📣 **異議申し立て** 「**${a.word}**」 — <@${a.user_id}>\n辞書に見つからなかった言葉です。登録すると、このサーバーでは、今後、通ります。${tail}`;
async function appealButton(i, word) {
  const g = i.guildId, st = getSettings(g);
  if (!isKana(word)) return i.reply({ content: 'この言葉は、申し立てできません。', ...EPH });
  const r = createAppeal(g, word, i.user.id);
  if (r.error === 'approved') return i.reply({ content: `「${word}」は、もう、登録されています。もう一度、送ってみてください。`, ...EPH });
  if (r.error === 'pending') return i.reply({ content: `「${word}」は、もう、申し立てられています。運営の確認を、待ってください。`, ...EPH });
  if (r.error === 'limit') return i.reply({ content: `確認待ちの申し立てが、${MAX_PENDING_PER_USER}件あります。決まってから、また、申し立ててください。`, ...EPH });
  await postAppeal(i.client, g, { id: r.id, word, user_id: i.user.id, msg_id: null }); // 確認用のチャンネルがあれば、ボタンつきで、流す
  return i.reply({ content: `📣 「${word}」を、申し立てました。運営が、確認して、登録するか決めます。`, ...EPH });
}
/** 申し立てを、確認チャンネルに、ボタンつきで流す(まだ流していないものだけ)。設定したチャンネルがなければ、何もしない */
async function postAppeal(client, g, a) {
  const st = getSettings(g); if (!st.appealChannelId || a.msg_id) return false;
  const ch = await chanOf(client, st.appealChannelId); if (!ch?.send || ch.guildId !== g) return false;
  const m = await ch.send({ content: reviewText(a), components: reviewRow(a.id), allowedMentions: NO_MENTION }).catch(() => null);
  if (!m) return false;
  db.prepare('UPDATE shiritori_appeals SET ch_id=?, msg_id=? WHERE id=?').run(ch.id, m.id, a.id); return true;
}
/** 確認待ちのうち、まだ流していない(チャンネルを決める前に出たもの・流せなかったもの)を、全部、流す */
export async function flushAppeals(client, g) {
  let n = 0; for (const a of listAppeals(g, ['pending'], 200).reverse()) if (!a.msg_id && await postAppeal(client, g, a)) n++;
  return n;
}
/** 運営向けのお知らせ(審議など)。確認チャンネルが決まっていて、いまのチャンネルと違うときだけ */
async function notifyStaff(client, g, fromCh, content) {
  const st = getSettings(g); if (!st.appealChannelId || st.appealChannelId === fromCh) return;
  const ch = await chanOf(client, st.appealChannelId); await ch?.send?.({ content, allowedMentions: NO_MENTION }).catch(() => {});
}
const msgLink = (g, ch, id) => `https://discord.com/channels/${g}/${ch}/${id}`;
/** 確認用のメッセージの、ボタンを、消して、結果を書く(ダッシュボードで決めたときも) */
async function closeReview(client, a, text) {
  if (!a.ch_id || !a.msg_id) return;
  const ch = await chanOf(client, a.ch_id); await ch?.messages?.edit?.(a.msg_id, { content: text, components: [], allowedMentions: NO_MENTION }).catch(() => {});
}
const decidedText = (a, by) => `${a.status === 'approved' ? '✅ **登録しました**' : '❌ **却下しました**'} 「**${a.word}**」 — <@${a.user_id}> の申し立て(決めた人: <@${by}>)`;
async function decideButton(i, id, decision) {
  if (!hasAccessSync(i.guild, i.member, i.user.id)) return i.reply({ content: '決められるのは、運営(管理者)だけです。', ...EPH });
  const r = decideAppeal(i.guildId, id, decision, i.user.id);
  if (!r) return i.reply({ content: 'その申し立ては、見つかりません。', ...EPH });
  if (r.error) return i.reply({ content: 'この申し立ては、もう、決まっています。', ...EPH });
  return i.update({ content: decidedText(r.appeal, i.user.id), components: [], allowedMentions: NO_MENTION });
}

/** 観戦の一覧: 進行中 → 終了済み(新しい順)の、プライベートスレッド。選ぶと、その人が、スレッドに追加される */
async function watchList(i) {
  const g = i.guildId, st = getSettings(g);
  if (!st.allowSpectate) return i.reply({ content: 'このサーバーでは、観戦は、オフです。', ...EPH });
  const recs = Object.entries(threadRecs(g)).map(([id, r]) => ({ id, ...r })).filter((r) => r.starter !== i.user.id);
  const on = recs.filter((r) => r.status === 'on').sort((a, b) => (b.at ?? 0) - (a.at ?? 0)), end = recs.filter((r) => r.status === 'end').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const list = [...on, ...end].slice(0, 25);
  if (!list.length) return i.reply({ content: '観戦できる、しりとりは、まだ、ありません。', ...EPH });
  const opts = list.map((r) => { const gm = getGame(g, r.id); return { label: `${r.status === 'on' ? '【進行中】' : '【終了済み】'}${r.base || '?'}${r.status === 'on' ? `(${gm ? chainOf(gm) : 0}語)` : `(${r.chain ?? 0}語)`}`.slice(0, 100), value: r.id }; });
  return i.reply({ content: `👀 どのしりとりを、見ますか?(選ぶと、そのスレッドに、入れます。**進行中 ${on.length}件 ・ 終了済み ${end.length}件**)`, ...EPH,
    components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('shiritori:watchsel').setPlaceholder('スレッドを選ぶ').addOptions(opts))] });
}
async function watchJoin(i) {
  const g = i.guildId, id = i.values?.[0], rec = threadRecs(g)[id];
  if (!getSettings(g).allowSpectate || !rec) return i.update({ content: 'そのしりとりは、もう、見られません。', components: [] });
  const th = await chanOf(i.client, id);
  if (!th?.members) return i.update({ content: 'そのスレッドが、見つかりません。(消されたかもしれません)', components: [] });
  try {
    if (th.archived) await th.setArchived(false).catch(() => {}); // 終わって、しまわれていたら、開く
    await th.members.add(i.user.id);
    return i.update({ content: `👀 スレッドに、入りました: <#${id}>\n-# 見るだけにしてください。言葉は、始めた人の分だけが、数えられます`, components: [] });
  } catch (e) {
    console.warn('[shiritori] 観戦に追加できませんでした:', e.message);
    return i.update({ content: 'スレッドに、入れませんでした。(BOTの権限が、足りないかもしれません)', components: [] });
  }
}

/** ボタン: しりとりを始める(プライベートスレッドを作る)/ ランキング / もう一度 */
export const shiritoriButton = {
  id: 'shiritori',
  async execute(i) {
    const action = i.customId.split(':')[1], g = i.guildId, st = getSettings(g);
    if (action === 'appeal') return appealButton(i, i.customId.split(':').slice(2).join(':'));
    if (action === 'apok' || action === 'apno') return decideButton(i, Number(i.customId.split(':')[2]), action === 'apok' ? 'approved' : 'rejected');
    if (action === 'dlok' || action === 'dlng') return voteButton(i, action === 'dlok' ? 'ok' : 'ng');
    if (action === 'watch') return watchList(i);
    if (action === 'watchsel') return watchJoin(i);
    if (action === 'statsme') return i.update({ content: '', embeds: [statsEmbed(g, i.user)], components: [], allowedMentions: NO_MENTION });
    if (action === 'statsmenu') { // 選んだ人の戦績
      const id = i.values?.[0], u = i.users?.get?.(id) ?? await i.client.users.fetch(id).catch(() => null);
      if (!u) return i.update({ content: 'その人が、見つかりません。', components: [] });
      return i.update({ content: '', embeds: [statsEmbed(g, u)], components: [], allowedMentions: NO_MENTION });
    }
    if (action === 'rank') return i.reply({ embeds: [rankingEmbed(g, 'wins', i.user.id)], allowedMentions: NO_MENTION, ...EPH });
    if (!st.enabled) return i.reply({ content: 'このサーバーでは、しりとりはオフです。', ...EPH });
    if (action === 'again') { // 同じスレッドで、もう一度(始めた人だけ)
      const old = getGame(g, i.channelId);
      if (old) return i.reply({ content: 'まだ、しりとりの途中です。', ...EPH });
      const nw = startGame(g, i.channelId, i.user.id, { level: st.level, mode: 'solo', first: 'bot', thread: true });
      return i.reply({ content: introText(nw, i.user.id, st), allowedMentions: NO_MENTION });
    }
    return newThreadGame(i);
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
    '言葉は、`/shiritori say` で送ります。メッセージで送れるサーバー(管理者が設定)では、そのまま、ひらがなで書いても、OKです。漢字も使えます(林檎 → りんご。読みで、続けます)。',
    '辞書にない言葉(名詞でないもの・存在しない言葉)は、「見つかりません」と断ります(負けには、なりません)。',
    '「ん」で終わる・同じ言葉・時間切れは負け。BOTが言葉に詰まったら、あなたの勝ち。',
    '`/shiritori ranking` で、ランキング(勝ち数・最長・勝率)、`/shiritori words` で、サーバーでいちばん使われた言葉、`/shiritori stats` で、自分の戦績を見られます。',
    '人どうしで遊ぶなら、`/shiritori start mode:人どうし`(ルミは審判。メッセージで、順番に言葉をつなぎます)。管理者が、チャンネルを登録すると、常設になります。',
    '管理者が、チャンネルに「しりとりを始める」のボタンを置くと(`/shiritori panel`)、押した人だけの、プライベートスレッドで、遊べます。',
  ].join('\n'),

  register({ client, router }) {
    CLIENT = client; // スレッドの名前を変えるため
    registerButtonOverride('shiritori start', (i) => newThreadGame(i));
    registerButtonOverride('shiritori stats', (i) => i.reply({ content: 'だれの戦績を見ますか?', ...EPH, components: [ // 他の人の戦績も、見られる
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('shiritori:statsmenu').setPlaceholder('見たい人を選ぶ').setMinValues(1).setMaxValues(1)),
      new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shiritori:statsme').setLabel('自分の戦績').setEmoji('🙋').setStyle(ButtonStyle.Primary))] })); // カテゴリーパネルの「しりとりを始める」も、プライベートスレッドで始める
    router.get('/settings', (req, res) => res.json({ ...getSettings(req.guild.id), levels: LEVELS, words: dictSize(), intent: client.options.intents.has('MessageContent') }));
    router.put('/settings', (req, res) => {
      if (!canEditAccess(req.access)) return res.status(403).json({ error: '変えられるのは、サーバーのオーナー・管理者・運営だけです' });
      const before = getSettings(req.guild.id).appealChannelId, out = saveSettings(req.guild.id, req.body ?? {});
      if (out.appealChannelId && out.appealChannelId !== before) { // 確認チャンネルを決めた・変えた: 確認待ちを、全部、そちらに流す
        db.prepare("UPDATE shiritori_appeals SET ch_id=NULL, msg_id=NULL WHERE guild_id=? AND status='pending'").run(req.guild.id);
        flushAppeals(client, req.guild.id).catch((e) => console.warn('[shiritori] 申し立てを流せませんでした:', e.message));
      }
      res.json({ ...out, levels: LEVELS, words: dictSize() });
    });

    // ランキング(ダッシュボード用): 名前つき
    const nameOf = async (g, id) => { const m = req_guild(g)?.members?.cache?.get(id) ?? await req_guild(g)?.members?.fetch?.(id).catch(() => null); return m?.displayName ?? client.users.cache.get(id)?.username ?? '(不明)'; };
    const req_guild = (g) => client.guilds.cache.get(g);
    router.get('/ranking', async (req, res) => {
      const g = req.guild.id, by = req.query.by in RANK_BY ? req.query.by : 'wins';
      const players = await Promise.all(rankingRows(g, by, 20).map(async (r) => ({ ...r, name: await nameOf(g, r.user_id) })));
      res.json({ by, ranks: RANK_BY, players, words: topWords(g, 20) });
    });
    // 異議申し立て(ダッシュボード): 運営が、登録するか決める
    const withNames = async (g, rows) => Promise.all(rows.map(async (r) => ({ ...r, name: await nameOf(g, r.user_id), by: r.decided_by ? await nameOf(g, r.decided_by) : null })));
    router.get('/appeals', async (req, res) => {
      const g = req.guild.id;
      res.json({ pending: await withNames(g, listAppeals(g, ['pending'], 100)), approved: await withNames(g, listAppeals(g, ['approved'], 200)), rejected: await withNames(g, listAppeals(g, ['rejected'], 20)), channelId: getSettings(g).appealChannelId });
    });
    router.post('/appeals/:id', async (req, res) => {
      const g = req.guild.id, decision = ['approved', 'rejected', 'removed'].includes(req.body?.decision) ? req.body.decision : null;
      if (!decision) return res.status(400).json({ error: '決め方が不正です' });
      const r = decideAppeal(g, Number(req.params.id), decision, req.actor?.id ?? req.session?.user?.id);
      if (!r) return res.status(404).json({ error: '申し立てが見つかりません' });
      if (r.error) return res.status(409).json({ error: 'もう、決まっています' });
      if (decision !== 'removed') await closeReview(client, r.appeal, decidedText(r.appeal, r.appeal.decided_by));
      res.json({ ok: true });
    });
    // 過去ログの取り込み: すでに、人どうしで、しりとりをしていたチャンネル(スレッド)の言葉を、ランキングに数える
    router.post('/import', async (req, res) => {
      if (!canEditAccess(req.access)) return res.status(403).json({ error: '取り込めるのは、サーバーのオーナー・管理者・運営だけです' });
      if (!client.options.intents.has('MessageContent')) return res.status(400).json({ error: 'BOTがメッセージの本文を読めないため、取り込めません(MESSAGE CONTENT INTENT が必要です)' });
      const g = req.guild.id, ch = await chanOf(client, String(req.body?.channel_id ?? ''));
      if (!ch?.messages || ch.guildId !== g) return res.status(400).json({ error: 'チャンネル(スレッド)が、見つかりません' });
      try { res.json(await importHistory(client, g, ch)); } catch (e) { console.warn('[shiritori] 取り込みに失敗:', e.message); res.status(500).json({ error: `取り込めませんでした: ${e.message}` }); }
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
        if (!st.enabled) return;
        let game = getGame(g, msg.channelId);
        if (!game) { // 人どうしの、常設のチャンネル(や、そのスレッド)で、言葉らしい発言があれば、自動で、始める
          const plain = !!msg.channel?.isThread?.();
          if (!isPvpChannel(st, msg.channelId, msg.channel?.parentId) || !looksLikeWord(msg.content, plain)) return;
          game = startGame(g, msg.channelId, msg.author.id, { mode: 'pvp', plain });
        }
        if (game.mode !== 'pvp' && !st.messageMode) return;
        const r = await play(g, msg.channelId, msg.author.id, msg.content, { isMessage: true, msgId: msg.id });
        if (!r) return;
        if (r.react) await msg.react(r.react).catch(() => {});
        if (r.accepted && st.deliberation) { // 審議: 最新の言葉にだけ、⚖️ をつける
          await msg.react('⚖️').catch(() => {});
          if (r.prevMsg) { const pm = await msg.channel.messages.fetch(r.prevMsg).catch(() => null); pm?.reactions?.cache?.get('⚖️')?.users?.remove?.(client.user.id).catch(() => {}); }
        }
        if (r.text) await msg.reply({ content: r.text, allowedMentions: { parse: [], repliedUser: false }, ...(r.again ? { components: againRow() } : r.appeal ? { components: appealRow(r.appeal) } : {}) });
      } catch (e) { console.warn('[shiritori] メッセージの処理に失敗:', e.message); }
    });

    // 審議: 最新の言葉の ⚖️ を、だれかが押したら、投票を始める
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
      try {
        if (user.bot || reaction.emoji.name !== '⚖️') return;
        if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
        const g = reaction.message.guildId; if (!g) return;
        const st = getSettings(g), ch = reaction.message.channelId, game = getGame(g, ch);
        if (!st.enabled || !st.deliberation || game?.mode !== 'pvp' || game.dlb) return;
        const last = game.words.at(-1);
        if (!last || last.msg !== reaction.message.id || last.locked) return; // 最新の言葉だけ(審議ずみのものも、不可)
        if (last.by === user.id) { reaction.users.remove(user.id).catch(() => {}); return; }   // 自分の言葉は、審議できない
        await openDeliberation(client, g, ch, game, user.id);
      } catch (e) { console.warn('[shiritori] 審議の開始に失敗:', e.message); }
    });

    // 時間切れの掃除(15秒ごと): 人が、時間内に答えなかったら、BOTの勝ち
    const sweep = async () => {
      const now = Date.now();
      for (const g of client.guilds.cache.keys()) {
        let all; try { all = loadAll(g); } catch { continue; }
        for (const [ch, game] of Object.entries(all)) {
          if (game.dlb && now > game.dlb.until) { // 審議の時間切れ: 票の多い方(同じなら、有効)
            const c = dlbCount(game.dlb); await settleDeliberation(client, g, ch, game, c.ng > c.ok ? 'ng' : 'ok'); continue;
          }
          if (now <= game.until + 1000 || game.dlb) continue;
          if (game.mode === 'pvp') { // 人どうし: しばらく動きがなかったら、勝ち負けなしで、終わる
            finish(g, ch, game, {});
            if (chainOf(game) >= 2) (await chanOf(client, ch))?.send?.({ content: `⏰ しばらく動きがなかったので、しりとりを終わります。(${chainOf(game)}語続きました)`, allowedMentions: NO_MENTION }).catch(() => {});
            continue;
          }
          finish(g, ch, game, { losers: game.mode === 'solo' ? [game.starter] : [] });
          const c = await chanOf(client, ch);
          c?.send?.({ content: `⏰ 時間切れ! **${BOT}の勝ち!** (${chainOf(game)}語続きました)`, allowedMentions: NO_MENTION, ...(game.thread ? { components: againRow() } : {}) }).catch(() => {});
        }
      }
    };
    const t = setInterval(() => sweep().catch((e) => console.warn('[shiritori] 掃除に失敗:', e.message)), 15_000); t.unref?.();
  },
};
