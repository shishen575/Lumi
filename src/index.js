try { process.loadEnvFile('.env'); } catch { /* .env が無くても環境変数があればOK */ }
const { createClient } = await import('./core/bot.js');
const { startWeb } = await import('./core/web.js');
const { startTunnel } = await import('./core/tunnel.js');
const { loadFeatures } = await import('./core/loader.js');

for (const k of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET']) {
  if (!process.env[k]) { console.error(`環境変数 ${k} が未設定です`); process.exit(1); }
}
const client = createClient();
const features = await loadFeatures();
startWeb(client, features);
startTunnel();
await client.login(process.env.DISCORD_TOKEN);
