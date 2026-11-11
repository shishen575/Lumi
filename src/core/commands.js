import { Events, SlashCommandBuilder, EmbedBuilder } from 'discord.js';

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
    try { await cmd.execute(i); }
    catch (e) {
      console.error(`[commands] /${i.commandName}:`, e);
      const msg = { content: 'エラーが発生しました。', ephemeral: true };
      if (i.deferred || i.replied) await i.followUp(msg).catch(() => {}); else await i.reply(msg).catch(() => {});
    }
  });
  console.log(`[commands] ${cmds.length} 個のコマンドを登録します: ${[...byName.keys()].map((n) => '/' + n).join(' ')}`);
}

/** 登録済みコマンドと各機能の `help` 文から、ヘルプを自動生成する */
function helpCommand(cmds, features) {
  const all = [...cmds.map((c) => c.data), { name: 'help', description: 'このヘルプを表示します' }];
  return {
    data: new SlashCommandBuilder().setName('help').setDescription('Lumiの使い方とコマンド一覧を表示します').setDMPermission(false),
    async execute(i) {
      const embed = new EmbedBuilder()
        .setColor(0x6d5dfc)
        .setTitle('Lumi ヘルプ')
        .addFields({ name: 'コマンド一覧', value: [...new Map(all.map((d) => [d.name, d])).values()]
          .map((d) => `\`/${d.name}\` — ${d.description}`).join('\n') });
      for (const f of features) if (f.help) embed.addFields({ name: f.title ?? f.name, value: f.help });
      const base = process.env.BASE_URL;
      if (base && i.memberPermissions?.has('ManageRoles')) {
        embed.addFields({ name: '設定(管理者向け)', value: `ダッシュボード: ${base}` });
      }
      await i.reply({ embeds: [embed], ephemeral: true });
    },
  };
}
