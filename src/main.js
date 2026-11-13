try { process.loadEnvFile('.env'); } catch { /* .env が無くても環境変数があればOK */ }
const { createClient } = await import('./core/bot.js');
const { startWeb } = await import('./core/web.js');
const { startTunnel } = await import('./core/tunnel.js');
const { loadFeatures } = await import('./core/loader.js');
const { setupCommands } = await import('./core/commands.js');
const { startHealthMonitor } = await import('./core/health.js');
const { installSignalHandlers, onShutdownCleanup } = await import('./core/shutdown.js');

for (const k of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET']) {
  if (!process.env[k]) { console.error(`環境変数 ${k} が未設定です`); process.exit(1); }
}
const client = createClient();
installSignalHandlers(); // 停止・再起動の合図で、お知らせを出して5秒待ってから終了する
onShutdownCleanup(() => client.destroy());
const features = await loadFeatures();
startHealthMonitor(client);
setupCommands(client, features);
startWeb(client, features);
startTunnel();
await client.login(process.env.DISCORD_TOKEN);
