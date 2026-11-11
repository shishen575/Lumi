import crypto from 'node:crypto';

export const RESTART_CODE = 42; // この終了コードのときだけ、起動スクリプトが git pull して再起動する

/**
 * GitHub push Webhook を受けて自己更新する。GITHUB_WEBHOOK_SECRET 未設定なら無効。
 * 署名(HMAC-SHA256)を検証し、対象ブランチへのpushのときだけ再起動を要求する。
 */
export function mountGithubWebhook(app, { onUpdate = () => setTimeout(() => process.exit(RESTART_CODE), 500) } = {}) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;
  const branch = process.env.GIT_BRANCH || 'main';

  app.post('/webhook/github', (req, res) => {
    const sig = req.get('x-hub-signature-256') || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody ?? '').digest('hex');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).send('bad signature');

    const event = req.get('x-github-event');
    if (event === 'ping') return res.send('pong');
    if (event !== 'push') return res.status(202).send('ignored event');
    if (req.body?.ref !== `refs/heads/${branch}`) return res.status(202).send('ignored branch');

    console.log(`[webhook] push to ${branch} → 更新のため再起動します`);
    res.status(202).send('updating');
    onUpdate();
  });
  console.log(`[webhook] GitHub Webhook 有効 (/webhook/github, branch=${branch})`);
  return true;
}
