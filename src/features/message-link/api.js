import { GatewayIntentBits } from 'discord.js';
import { getSettings, setSettings } from './settings.js';

/** router は /api/guilds/:gid/f/message-link に載っていて、req.guild が使える */
export function mountApi(router, client) {
  const view = (req) => ({ enabled: !!getSettings(req.guild.id).enabled, intentEnabled: client.options.intents.has(GatewayIntentBits.MessageContent) });
  router.get('/settings', (req, res) => res.json(view(req)));
  router.put('/settings', (req, res) => { setSettings(req.guild.id, { enabled: !!req.body?.enabled }); res.json(view(req)); });
}
