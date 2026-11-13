import { spawn } from 'node:child_process';
import fs from 'node:fs';

/** cloudflared の通信方式。TUNNEL_PROTOCOL: http2(TCP。既定)/ quic(UDP)/ auto(cloudflaredにまかせる)。
 *  家庭用ルーターは、QUIC(UDP)の常時接続が苦手なことがあり、同じ回線の他の通信(Discordのゲートウェイ)を巻き込む疑いがあるため、既定は TCP */
export function tunnelArgs(token, protocol = process.env.TUNNEL_PROTOCOL) {
  const p = String(protocol ?? '').trim().toLowerCase() || 'http2';
  const args = ['tunnel', '--no-autoupdate'];
  if (['http2', 'quic'].includes(p)) args.push('--protocol', p);
  return [...args, 'run', '--token', token];
}

/** TUNNEL_TOKEN があれば cloudflared を子プロセスとして起動(切れたら自動再起動) */
export function startTunnel() {
  const token = process.env.TUNNEL_TOKEN;
  if (!token) return;
  const bin = ['./bin/cloudflared', 'cloudflared'].find((b) => b.startsWith('.') ? fs.existsSync(b) : true);
  const run = () => {
    const p = spawn(bin, tunnelArgs(token), { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', (e) => console.error('[tunnel] 起動失敗:', e.message));
    p.on('exit', (c) => { console.error(`[tunnel] 終了(${c}) 5秒後に再起動`); setTimeout(run, 5000); });
    process.on('exit', () => p.kill());
  };
  console.log(`[tunnel] Cloudflare Tunnel を起動します (通信方式: ${(process.env.TUNNEL_PROTOCOL || 'http2').toLowerCase()})`);
  run();
}
