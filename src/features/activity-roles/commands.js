import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';

const eph = (on = true) => (on ? { flags: MessageFlags.Ephemeral } : {}); // 自分だけに表示
import { db } from '../../core/db.js';
import { METRICS, getRules, getStats, metricValue } from './db.js';
import { pairStats, fastestSinceJoin, joinToStats, roleObtainedAt, trackingSince, dur, importNotices } from './roletime.js';
import { hasAccessSync } from '../../core/access.js';

const COL = { messages: 'messages', reactions_received: 'reactions_received', reactions_given: 'reactions_given', voice_minutes: 'voice_seconds' };
const UNIT = { messages: '回', reactions_received: '個', reactions_given: '個', voice_minutes: '分' };

const fmt = (metric, v) => {
  if (metric !== 'voice_minutes') return `${v.toLocaleString()}${UNIT[metric]}`;
  const h = Math.floor(v / 60), m = v % 60;
  return h ? `${h}時間${m}分` : `${m}分`;
};

/** サーバー内の順位(同数は同順位) */
function position(guildId, metric, userId) {
  const col = COL[metric];
  const mine = db.prepare(`SELECT ${col} AS v FROM stats WHERE guild_id=? AND user_id=?`).get(guildId, userId)?.v ?? 0;
  const total = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>0`).get(guildId).c;
  if (mine <= 0) return { pos: null, total };
  const above = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>?`).get(guildId, mine).c;
  return { pos: above + 1, total };
}

export const rankCommand = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('発言数・順位・ランク・次のランクまでの必要数を表示します')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('見たい相手(省略すると自分)'))
    .addBooleanOption((o) => o.setName('private').setDescription('自分だけに表示する')),

  async execute(i) {
    const user = i.options.getUser('user') ?? i.user;
    if (user.bot) return i.reply({ content: 'BOTは集計対象外です。', ...eph() });
    const gid = i.guildId;
    const stats = getStats(gid, user.id);
    const rules = getRules(gid);
    const metrics = Object.keys(METRICS).filter((m) => m === 'messages' || rules.some((r) => r.metric === m));

    const fields = metrics.map((metric) => {
      const v = metricValue(stats, metric);
      const { pos, total } = position(gid, metric, user.id);
      const tiers = rules.filter((r) => r.metric === metric).sort((a, b) => a.threshold - b.threshold);
      const cur = [...tiers].reverse().find((r) => r.threshold <= v);
      const next = tiers.find((r) => r.threshold > v);
      const lines = [
        `**${fmt(metric, v)}**`,
        `順位: ${pos ? `**${pos}位** / ${total}人` : '圏外'}`,
      ];
      if (tiers.length) {
        { const got = cur ? roleObtainedAt(gid, user.id, cur.role_id) : null; lines.push(`ランク: ${cur ? `<@&${cur.role_id}>` : 'なし'}${got ? `(取った日: <t:${Math.floor(got / 1000)}:D>)` : ''}`); }
        lines.push(next
          ? `次: <@&${next.role_id}> まであと **${fmt(metric, next.threshold - v)}**(${fmt(metric, next.threshold)}で到達)`
          : '次: 最高ランクに到達しています 🎉');
      }
      return { name: METRICS[metric], value: lines.join('\n'), inline: false };
    });

    const embed = new EmbedBuilder()
      .setAuthor({ name: (i.options.getMember('user') ?? i.member)?.displayName ?? user.username, iconURL: user.displayAvatarURL() })
      .setColor(0x6d5dfc)
      .addFields(fields);
    await i.reply({ embeds: [embed], ...eph(i.options.getBoolean('private') ?? false) });
  },
};

// ---------- /top : ランキング(10位ごとにページ送り) ----------
const PAGE = 10;

function pageData(gid, metric, page) {
  const col = COL[metric];
  const total = db.prepare(`SELECT COUNT(*) AS c FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>0`).get(gid).c;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const p = Math.min(Math.max(1, page), pages);
  const rows = db.prepare(
    `SELECT user_id, v, rk FROM (
       SELECT user_id, ${col} AS v, RANK() OVER (ORDER BY ${col} DESC) AS rk FROM stats WHERE guild_id=? AND is_left=0 AND ${col}>0
     ) ORDER BY v DESC, user_id LIMIT ? OFFSET ?`
  ).all(gid, PAGE, (p - 1) * PAGE);
  return { rows, total, pages, page: p };
}

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

async function renderTop(i, metric, page) {
  const gid = i.guildId;
  const d = pageData(gid, metric, page);
  // メンバーの取得はしない(ゲートウェイ経由の問い合わせなので、遅い時間帯に、3秒の応答期限を超えうる)。ランキングは、退出した人を除いて数えている
  const val = (v) => fmt(metric, metric === 'voice_minutes' ? Math.floor(v / 60) : v);
  const lines = d.rows.map((r) =>
    `${MEDAL[r.rk] ?? `**${r.rk}位**`} <@${r.user_id}> — ${val(r.v)}`);
  const mine = position(gid, metric, i.user.id);
  const embed = new EmbedBuilder()
    .setAuthor({ name: i.member?.displayName ?? i.user.globalName ?? i.user.username, iconURL: i.user.displayAvatarURL?.() }) // 実行した人の名前
    .setColor(0x6d5dfc)
    .setTitle(`🏆 ${METRICS[metric]}ランキング`)
    .setDescription(lines.join('\n') || 'まだデータがありません')
    .setFooter({ text: `${d.page} / ${d.pages} ページ ・ ${i.member?.displayName ?? i.user.globalName ?? i.user.username}: ${mine.pos ? `${mine.pos}位` : '圏外'}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('top:first').setEmoji('⏮').setStyle(ButtonStyle.Secondary).setDisabled(d.page <= 1),
    new ButtonBuilder().setCustomId('top:prev').setLabel('前へ').setStyle(ButtonStyle.Primary).setDisabled(d.page <= 1),
    new ButtonBuilder().setCustomId('top:next').setLabel('次へ').setStyle(ButtonStyle.Primary).setDisabled(d.page >= d.pages),
    new ButtonBuilder().setCustomId('top:last').setEmoji('⏭').setStyle(ButtonStyle.Secondary).setDisabled(d.page >= d.pages),
  );
  return { embeds: [embed], components: d.pages > 1 ? [row] : [], page: d.page, pages: d.pages };
}

export const topCommand = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('ランキングを10位ごとに表示します')
    .setDMPermission(false)
    .addStringOption((o) => o.setName('metric').setDescription('何のランキングか(省略すると発言数)')
      .addChoices(...Object.entries(METRICS).map(([value, name]) => ({ name, value }))))
    .addIntegerOption((o) => o.setName('page').setDescription('開くページ(省略すると1)').setMinValue(1))
    .addBooleanOption((o) => o.setName('private').setDescription('自分だけに表示する')),

  async execute(i) {
    const metric = i.options.getString('metric') ?? 'messages';
    let page = i.options.getInteger('page') ?? 1;
    const view = await renderTop(i, metric, page);
    page = view.page;
    const res = await i.reply({ embeds: view.embeds, components: view.components,
      ...eph(i.options.getBoolean('private') ?? false), withResponse: true }); // fetchReply は、古い書き方(警告が出る)
    const msg = res.resource?.message ?? await i.fetchReply();
    if (!view.components.length) return;

    // ボタンは実行した本人だけが操作できる(2分操作がなければ無効化)
    const collector = msg.createMessageComponentCollector({ idle: 120_000, time: 600_000 });
    collector.on('collect', async (b) => {
      if (b.user.id !== i.user.id) return b.reply({ content: 'コマンドを実行した人だけがページを切り替えられます。`/top` で自分用に開けます。', ...eph() });
      const cur = await renderTop(i, metric, page);
      const to = { 'top:first': 1, 'top:prev': page - 1, 'top:next': page + 1, 'top:last': cur.pages }[b.customId] ?? page;
      const next = await renderTop(i, metric, to);
      page = next.page;
      await b.update({ embeds: next.embeds, components: next.components });
    });
    collector.on('end', () => i.editReply({ components: [] }).catch(() => {}));
  },
};

// ---------- /roles : 昇格条件(取れるロールと、その条件)の一覧 ----------
export const rolesCommand = {
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('このサーバーで取れるロールと、昇格の条件を表示します')
    .setDMPermission(false)
    .addBooleanOption((o) => o.setName('private').setDescription('自分だけに表示する')),

  async execute(i) {
    const rules = getRules(i.guildId).filter((r) => i.guild.roles.cache.has(r.role_id)); // 削除されたロールは出さない
    if (!rules.length) {
      return i.reply({ content: 'このサーバーには、まだ昇格のルールが登録されていません。', ...eph() });
    }
    const stats = getStats(i.guildId, i.user.id);
    const fields = [];
    for (const metric of Object.keys(METRICS)) {
      const tiers = rules.filter((r) => r.metric === metric).sort((a, b) => a.threshold - b.threshold);
      if (!tiers.length) continue;
      const v = metricValue(stats, metric);
      const nextId = tiers.find((r) => r.threshold > v)?.id; // 次に目指すルール
      const lines = tiers.map((r) => {
        const mark = r.threshold <= v ? '✅' : r.id === nextId ? '▶' : '▫';
        const left = r.id === nextId ? `(あと **${fmt(metric, r.threshold - v)}**)` : '';
        const notes = [r.replace_lower ? '上のランクで入れ替わり' : '', r.revoke ? '下回ると外れます' : ''].filter(Boolean);
        return [`${mark} **${fmt(metric, r.threshold)}**以上 → <@&${r.role_id}>`, left, notes.length ? `_(${notes.join('・')})_` : ''].filter(Boolean).join(' ');
      });
      // 1フィールドは1024文字まで。長いときは分ける
      let chunk = '';
      for (const line of lines) {
        if (chunk.length + line.length + 1 > 1000) { fields.push({ name: fields.some((f) => f.metric === metric) ? '\u200b' : `${METRICS[metric]}(あなた: ${fmt(metric, v)})`, value: chunk, metric }); chunk = ''; }
        chunk += (chunk ? '\n' : '') + line;
      }
      fields.push({ name: fields.some((f) => f.metric === metric) ? '\u200b' : `${METRICS[metric]}(あなた: ${fmt(metric, v)})`, value: chunk, metric });
    }
    const embed = new EmbedBuilder()
      .setAuthor({ name: i.member?.displayName ?? i.user.globalName ?? i.user.username, iconURL: i.user.displayAvatarURL?.() }) // 実行した人の名前
      .setColor(0x6d5dfc)
      .setTitle('取れるロールと昇格の条件')
      .setDescription('✅ 達成済み  ▶ 次の目標  ▫ これから')
      .addFields(fields.slice(0, 25).map(({ name, value }) => ({ name, value })))
      .setFooter({ text: '自分の詳しい順位は /rank で確認できます' });
    await i.reply({ embeds: [embed], ...eph(i.options.getBoolean('private') ?? false) });
  },
};

/* ---------- /roletime : ロールを取った時間・ロール間の達成時間・早かった人のランキング ---------- */
const MEDALS = ['🥇', '🥈', '🥉'];
const since = (g) => { const t = trackingSince(g); return t ? `記録の開始: <t:${Math.floor(t / 1000)}:D>(これより前に取ったロールの時刻は、分かりません)` : '記録は、まだ、始まっていません'; };
export const roletimeCommand = {
  data: new SlashCommandBuilder().setName('roletime').setDescription('ロールを取った時間と、ロール間の達成時間・いちばん早かった人のランキング').setDMPermission(false)
    .addSubcommand((c) => c.setName('pair').setDescription('ロールAを取ってから、ロールBを取るまでの時間(平均・中央値など)')
      .addRoleOption((o) => o.setName('from').setDescription('はじめのロール').setRequired(true)).addRoleOption((o) => o.setName('to').setDescription('次のロール').setRequired(true))
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('fastest').setDescription('そのロールを、いちばん早く取った人のランキング(サーバーに入ってから / 別のロールから)')
      .addRoleOption((o) => o.setName('role').setDescription('ランキングを見たいロール').setRequired(true)).addRoleOption((o) => o.setName('from').setDescription('どこから数えるか(省略すると、サーバーに入ってから)'))
      .addBooleanOption((o) => o.setName('public').setDescription('みんなに見せる(省略すると、自分だけ)')))
    .addSubcommand((c) => c.setName('me').setDescription('自分が、各ロールを取った日時と、サーバーに入ってからの時間'))
    .addSubcommand((c) => c.setName('import-notices').setDescription('【管理者向け】別のBOTなどの、ロール付与の通知から、取った時刻を取り込みます')
      .addChannelOption((o) => o.setName('channel').setDescription('通知が出ていたチャンネル(スレッド)').setRequired(true))
      .addUserOption((o) => o.setName('bot').setDescription('その通知を出したBOT(省略すると、BOTの発言すべて)'))
      .addRoleOption((o) => o.setName('role').setDescription('通知に、ロール名が無いとき: どのロールの通知か'))
      .addBooleanOption((o) => o.setName('preview').setDescription('記録せず、読み取れる例だけ見る'))),
  async execute(i) {
    const g = i.guildId, sub = i.options.getSubcommand(), joinedOf = (u) => i.guild.members.cache.get(u)?.joinedTimestamp ?? null, vis = () => eph(!i.options.getBoolean?.('public'));
    if (sub === 'import-notices') {
      if (!hasAccessSync(i.guild, i.member, i.user.id)) return i.reply({ content: '取り込めるのは、運営・サーバーのオーナー・管理者だけです。', ...eph(true) });
      const ch = i.options.getChannel('channel', true), bot = i.options.getUser('bot'), role = i.options.getRole('role'), preview = !!i.options.getBoolean('preview');
      await i.deferReply(eph(true));
      try {
        const r = await importNotices(i.guild, await i.guild.channels.fetch(ch.id), { authorId: bot?.id ?? null, roleId: role?.id ?? null, preview });
        const sample = r.samples.map((x) => `・<@${x.userId}> が **${x.roleName}**(<t:${Math.floor(x.at / 1000)}:f>)\n  -# ${x.text.replace(/\n/g, ' ')}`).join('\n');
        return i.editReply({ content: `${preview ? '👀 試し読み' : '✅ 取り込み'}: <#${ch.id}> の ${r.scanned}件の発言から、**${r.matched}件**の「ロールを取った」通知を、読み取りました。${preview ? '' : `(${r.added}件を、新しく記録)`}\n${sample || '読み取れる通知が、ありませんでした。'}${r.matched ? '' : `\n読み取れなかった発言の例: ${r.unread.map((t) => `「${t.replace(/\n/g, ' ')}」`).join(' ') || 'なし'}\n-# 通知に、だれかへのメンションと、ロールの名前(か、ロールのメンション)が、必要です。ロール名が無い通知は、role: で、ロールを決めてください。`}`, allowedMentions: { parse: [] } });
      } catch (e) { return i.editReply({ content: `読めませんでした: ${e.message}(BOTに、そのチャンネルを読む権限が必要です)` }); }
    }
    if (sub === 'me') {
      const rows = db.prepare("SELECT role_id, MIN(at) at FROM role_log WHERE guild_id=? AND user_id=? AND action='add' GROUP BY role_id ORDER BY at").all(g, i.user.id), joined = joinedOf(i.user.id);
      const e = new EmbedBuilder().setColor(0x6d5dfc).setTitle('🕒 ロールを取った日時').setDescription(rows.length ? rows.filter((r) => i.guild.roles.cache.has(r.role_id)).map((r) => `<@&${r.role_id}> — <t:${Math.floor(r.at / 1000)}:f>${joined && r.at >= joined ? `(入ってから ${dur(r.at - joined)})` : ''}`).join('\n') || '記録が、ありません' : '記録が、ありません。').addFields({ name: '記録', value: since(g) });
      return i.reply({ embeds: [e], ...eph(true), allowedMentions: { parse: [] } });
    }
    if (sub === 'pair') {
      const a = i.options.getRole('from', true), b = i.options.getRole('to', true), r = pairStats(g, a.id, b.id);
      const e = new EmbedBuilder().setColor(0x6d5dfc).setTitle('⏱️ ロール間の達成時間').setDescription(`<@&${a.id}> → <@&${b.id}>`);
      if (!r.n) e.addFields({ name: '結果', value: `両方を取った記録のある人が、いません。(${a.name}: ${r.fromCount}人 / ${b.name}: ${r.toCount}人の記録)` });
      else e.addFields({ name: `${r.n}人の記録`, value: `平均 **${dur(r.avg)}** ・ 中央値 **${dur(r.median)}**\n早い方 25%: ${dur(r.p25)} ・ 遅い方 75%: ${dur(r.p75)}\n最短 **${dur(r.min)}** ・ 最長 ${dur(r.max)}` },
        { name: '🏃 いちばん早かった人', value: r.fastest.map((x, n) => `${MEDALS[n] ?? `${n + 1}.`} <@${x.user_id}> — ${dur(x.ms)}`).join('\n') });
      e.addFields({ name: '記録について', value: `${since(g)}${r.backwards ? `\n-# ${r.backwards}人は、順番が逆(Bが先)なので、除きました` : ''}` });
      return i.reply({ embeds: [e], ...vis(), allowedMentions: { parse: [] } });
    }
    // fastest
    const role = i.options.getRole('role', true), from = i.options.getRole('from');
    const rows = from ? pairStats(g, from.id, role.id, 10).fastest : fastestSinceJoin(g, role.id, joinedOf, 10);
    const e = new EmbedBuilder().setColor(0xf1c40f).setTitle(`🏆 「${role.name}」を、いちばん早く取った人`).setDescription(`${from ? `「${from.name}」を取ってから` : 'サーバーに入ってから'}の、早い順です。`);
    e.addFields({ name: 'ランキング', value: rows.length ? rows.map((x, n) => `${MEDALS[n] ?? `${n + 1}.`} <@${x.user_id}> — **${dur(x.ms)}**`).join('\n') : '記録が、ありません。' });
    if (!from) { const st = joinToStats(g, role.id, joinedOf); if (st.n) e.addFields({ name: '全体', value: `${st.n}人 ・ 平均 ${dur(st.avg)} ・ 中央値 ${dur(st.median)}` }); }
    e.addFields({ name: '記録について', value: since(g) });
    return i.reply({ embeds: [e], ...vis(), allowedMentions: { parse: [] } });
  },
};
