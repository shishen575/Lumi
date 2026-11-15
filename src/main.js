try { process.loadEnvFile('.env'); } catch { /* .env が無くても環境変数があればOK */ }
const { createClient } = await import('./core/bot.js');
const { startWeb } = await import('./core/web.js');
const { startTunnel } = await import('./core/tunnel.js');
const { loadFeatures } = await import('./core/loader.js');
const { setupCommands } = await import('./core/commands.js');
const { startHealthMonitor } = await import('./core/health.js');
const { installSignalHandlers, onShutdownCleanup } = await import('./core/shutdown.js');
const { storageWarning } = await import('./core/storage-check.js');

// LUMI_NO_LOGIN=1: Discordにログインしない(Webだけ起動)。データの引っ越しの間、別の場所のBOTと二重に動かないようにするためのモード
const NO_LOGIN = process.env.LUMI_NO_LOGIN === '1';
for (const k of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET'].filter((x) => !(NO_LOGIN && x === 'DISCORD_TOKEN'))) {
  if (!process.env[k]) { console.error(`環境変数 ${k} が未設定です`); process.exit(1); }
}
{ const w = storageWarning(); if (w) console.warn(`[storage] ⚠️ ${w}`); else console.log('[storage] データの置き場: OK'); }
const client = createClient();
installSignalHandlers(); // 停止・再起動の合図で、お知らせを出して5秒待ってから終了する
onShutdownCleanup(() => client.destroy());
const features = await loadFeatures();
startHealthMonitor(client);
setupCommands(client, features);
startWeb(client, features);
startTunnel();
if (NO_LOGIN) console.log('[main] LUMI_NO_LOGIN=1 のため、Discordにはログインしません(Webだけ動いています)');
else await client.login(process.env.DISCORD_TOKEN);
