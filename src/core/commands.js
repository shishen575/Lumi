import { Events } from 'discord.js';

/**
 * 各機能の `commands: [{ data: SlashCommandBuilder, execute(interaction) }]` を集めて登録・実行する。
 * サーバー(ギルド)ごとに登録するので、変更がすぐ反映される。
 */
export function setupCommands(client, features) {
  const cmds = features.flatMap((f) => f.commands ?? []);
  if (!cmds.length) return;
  const byName = new Map(cmds.map((c) => [c.data.name, c]));
  const body = cmds.map((c) => c.data.toJSON());
  const register = (guild) =>
    guild.commands.set(body).catch((e) => console.error(`[commands] ${guild.name}:`, e.message));

  client.once(Events.ClientReady, () => client.guilds.cache.forEach(register));
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
