import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';

export function createClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // 特権インテント(要有効化)
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      // 新機能で必要になったらここに追加(例: MessageContent は特権)
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  });
  client.once(Events.ClientReady, (c) => console.log(`Bot ready: ${c.user.tag} (${c.guilds.cache.size} servers)`));
  return client;
}
