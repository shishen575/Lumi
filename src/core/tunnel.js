import { spawn } from 'node:child_process';
import fs from 'node:fs';

/** TUNNEL_TOKEN があれば cloudflared を子プロセスとして起動(切れたら自動再起動) */
export function startTunnel() {
  const token = process.env.TUNNEL_TOKEN;
  if (!token) return;
  const bin = ['./bin/cloudflared', 'cloudflared'].find((b) => b.startsWith('.') ? fs.existsSync(b) : true);
  const run = () => {
    const p = spawn(bin, ['tunnel', '--no-autoupdate', 'run', '--token', token], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', (e) => console.error('[tunnel] 起動失敗:', e.message));
    p.on('exit', (c) => { console.error(`[tunnel] 終了(${c}) 5秒後に再起動`); setTimeout(run, 5000); });
    process.on('exit', () => p.kill());
  };
  console.log('[tunnel] Cloudflare Tunnel を起動します');
  run();
}
