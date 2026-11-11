// 起動エントリ(監視役)。更新と再起動をここで担うので、パネルの起動コマンドは `node src/index.js` だけでよい。
//   1. AUTO_UPDATE=1 なら GitHub の最新に強制的に揃える(ローカルの変更があっても止まらない)
//   2. src/main.js(BOT本体)を子プロセスで起動
//   3. 終了コード42(Webhookによる更新要求)なら 1. に戻る。それ以外は終了
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

try { process.loadEnvFile('.env'); } catch { /* 環境変数があればOK */ }
const RESTART_CODE = 42;
const branch = process.env.GIT_BRANCH || 'main';
const entry = process.env.LUMI_ENTRY || 'src/main.js';
const sh = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit' });

function update() {
  if (process.env.AUTO_UPDATE !== '1' || !fs.existsSync('.git')) return;
  console.log(`[update] ${branch} の最新に更新します`);
  sh('git', ['config', '--global', '--add', 'safe.directory', '*']);
  const f = sh('git', ['fetch', '--depth', '1', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  if (f.status !== 0) return console.error('[update] fetch に失敗。現在のコードで起動します');
  sh('git', ['reset', '--hard', `origin/${branch}`]); // package-lock.json 等の変更があっても上書きする
  sh('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock']);
  const h = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  console.log(`[update] 現在のバージョン: ${h.stdout.trim()}`);
}

let child = null, stopping = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopping = true; child?.kill(sig); if (!child) process.exit(0); });
}

function run() {
  update();
  child = spawn(process.execPath, [entry], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    child = null;
    if (!stopping && code === RESTART_CODE) { console.log('[update] 更新のため再起動します'); return run(); }
    process.exit(code ?? (signal ? 1 : 0));
  });
}
run();
