import { Events, SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { hasAccessSync } from './access.js';

/**
 * 各機能の `commands: [{ data: SlashCommandBuilder, execute(interaction) }]` を集めて登録・実行する。
 * サーバー(ギルド)ごとに登録するので、変更がすぐ反映される。
 */
export function setupCommands(client, features) {
  const cmds = features.flatMap((f) => f.commands ?? []);
  if (!cmds.some((c) => c.data.name === 'help')) cmds.push(helpCommand(cmds, features)); // /help は自動生成
  if (!cmds.length) return;
  const byName = new Map(cmds.map((c) => [c.data.name, c]));
  const body = cmds.map((c) => c.data.toJSON());
  const register = (guild) =>
    guild.commands.set(body)
      .then((r) => console.log(`[commands] ${guild.name}: ${r.size} 個を登録しました`))
      .catch((e) => console.error(`[commands] ${guild.name}: 登録失敗 (${e.code ?? ''}) ${e.message}` +
        (e.code === 50001 ? ' → このサーバーに applications.commands 付きで招待し直してください' : '')));

  client.once(Events.ClientReady, () => {
    console.log(`[commands] ${client.guilds.cache.size} サーバーに登録します`);
    client.guilds.cache.forEach(register);
  });
  client.on(Events.GuildCreate, register);
  client.on(Events.InteractionCreate, async (i) => {
    if (!i.isChatInputCommand()) return;
    const cmd = byName.get(i.commandName);
    if (!cmd) return;
    const t0 = Date.now();
    const lag = t0 - i.createdTimestamp; // コマンドが送られてから、BOTが処理を始めるまで
    try { await cmd.execute(i); }
    catch (e) {
      if (e.code === 10062) { // 3秒以内に応答できなかった。再試行しても無効なので、要点だけ記録する
        console.warn(`[commands] /${i.commandName}: 3秒以内に応答できませんでした (受信まで ${lag}ms / 処理 ${Date.now() - t0}ms)`);
        return;
      }
      console.error(`[commands] /${i.commandName}:`, e);
      const msg = { content: 'エラーが発生しました。', flags: MessageFlags.Ephemeral };
      if (i.deferred || i.replied) await i.followUp(msg).catch(() => {}); else await i.reply(msg).catch(() => {});
    }
    if (lag > 1500 || Date.now() - t0 > 1500) {
      console.warn(`[commands] /${i.commandName} が遅れています (受信まで ${lag}ms / 処理 ${Date.now() - t0}ms)`);
    }
  });
  console.log(`[commands] ${cmds.length} 個のコマンドを登録します: ${[...byName.keys()].map((n) => '/' + n).join(' ')}`);
}

/** 登録済みコマンドと各機能の `help` 文から、ヘルプを自動生成する */
function helpCommand(cmds, features) {
  const all = [...cmds.map((c) => c.data), { name: 'help', description: 'このヘルプを表示します' }];
  return {
    data: new SlashCommandBuilder().setName('help').setDescription('Lumiの使い方とコマンド一覧を表示します').setDMPermission(false)
      .addBooleanOption((o) => o.setName('public').setDescription('全員に表示する(省略すると自分だけに表示)')),
    async execute(i) {
      const embed = new EmbedBuilder()
        .setColor(0x6d5dfc)
        .setTitle('Lumi ヘルプ')
        .addFields({ name: 'コマンド一覧', value: [...new Map(all.map((d) => [d.name, d])).values()]
          .map((d) => `\`/${d.name}\` — ${d.description}`).join('\n') });
      for (const f of features) if (f.help) embed.addFields({ name: f.title ?? f.name, value: f.help });
      const base = process.env.BASE_URL;
      const pub = i.options.getBoolean('public') ?? false;
      if (!pub && base && hasAccessSync(i.guild, i.member, i.user.id)) { // ダッシュボードを操作できる人にだけ案内(全員に表示するときは出さない)
        embed.addFields({ name: '設定(管理者向け)', value: `ダッシュボード: ${base.replace(/\/$/, '')}/dashboard/` });
      }
      await i.reply({ embeds: [embed], ...(pub ? {} : { flags: MessageFlags.Ephemeral }) }); // 既定は自分だけに表示
    },
  };
}
