import { Events } from 'discord.js';
import { mountApi } from './api.js';
import { handleMessage } from './grant.js';

export default {
  name: 'channel-roles',
  title: 'チャンネルロール',
  ui: '/dashboard/features/channel-roles.js',
  help: '特定のチャンネルで発言すると、決められたロールが自動で付与されます(自己紹介チャンネルで発言したら「メンバー」、など)。設定はダッシュボードの「チャンネルロール」から。',
  commands: [],
  register({ client, router }) {
    mountApi(router);
    client.on(Events.MessageCreate, (msg) => { handleMessage(msg).catch((e) => console.error('[channel-roles]', e.message)); });
  },
};
