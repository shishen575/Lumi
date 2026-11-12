import { Client, GatewayIntentBits, Partials, Events } from 'discord.js';

export function createClient() {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // 特権インテント(要有効化)
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
  ];
  // メッセージの本文を読む特権インテント。Developer Portal で「MESSAGE CONTENT INTENT」を先にONにして、
  // 環境変数 MESSAGE_CONTENT_INTENT=1 を設定したときだけ有効にする(ONにしていないのに要求すると、BOTが起動できない)
  if (process.env.MESSAGE_CONTENT_INTENT === '1') intents.push(GatewayIntentBits.MessageContent);
  const client = new Client({
    intents,
    partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
  });
  client.once(Events.ClientReady, (c) => console.log(`Bot ready: ${c.user.tag} (${c.guilds.cache.size} servers)`));
  return client;
}
