# Railway への引っ越し

BOT・ダッシュボード・公式サイトを、ひとまとめにして、Railway に移します。データ(`data/bot.db`)も、引き継ぎます。

## 0. 先に知っておくこと

- BOT のトークンは、**同時に2か所では動かせません**。切り替えの間は、自宅の BOT を止めます(止まるのは、15〜30分ほど)。
- `SESSION_SECRET` は、**いまと同じ値**にします。違うと、保存済みの読み上げトークンが復号できなくなります。
- 自宅の `data/bot.db` は、コピーなので、そのまま残ります。うまくいかなければ、自宅の BOT を起動し直して、元に戻せます。

## 1. Railway にプロジェクトを作る

1. Railway で **New Project → Deploy from GitHub repo** を選び、`shishen575/Lumi` を選びます。
2. リポジトリの `Dockerfile` と `railway.json` が、自動で使われます。
3. サービスの **Settings → Networking → Generate Domain** で、仮のアドレス(`○○.up.railway.app`)を作ります。

## 2. ボリュームを付ける(データの保存場所)【必ず、データを送る前に】

1. プロジェクトの全体の画面(サービスのカードが並ぶ画面)で、空いている所を**右クリック**(スマホは右上の **+ Create**、または `Ctrl+K` / `⌘+K` で「volume」)→ **Volume** を選び、サービスは **Lumi**、**Mount path** は `/app/data` にします。
2. **これがないと、再デプロイのたびに、データが消えます**(送ったデータも、消えます)。
3. 付いたか確認: Lumi の Variables に、`RAILWAY_VOLUME_MOUNT_PATH`(値は `/app/data`)が、自動で現れます。ボリュームがないと、ログと `/ping` に「ボリュームが付いていません」と警告が出ます。

## 3. 環境変数(Variables)

| 変数 | 値 |
|---|---|
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | いまと同じ |
| `SESSION_SECRET` | **いまと同じ** |
| `BASE_URL` | 最初は仮のアドレス(`https://○○.up.railway.app`)。あとで `https://lumi.shishen575.net` に変える |
| `OPERATOR_IDS` | いまと同じ |
| `MESSAGE_CONTENT_INTENT` | いまと同じ(`1` など) |
| `BUMP_EVERY` / `BUMP_MINUTES` / `TTS_API_URL` など | 使っているものだけ、いまと同じ |
| `LUMI_NO_LOGIN` | `1`(**引っ越しの間だけ**。Discord にログインしないで、Webだけ起動する) |
| `MIGRATION_TOKEN` | 16文字以上のランダムな文字列(**引っ越しの間だけ**) |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `10`(再起動の前の「5秒待つ」が、途中で切られないように) |

この時点では、`DISCORD_TOKEN` は **まだ入れません**。`TUNNEL_TOKEN` と `AUTO_UPDATE` は、使いません(入れない)。

## 4. データを引っ越す

1. 仮のアドレスが開けること(`/api/public` が表示されること)を、確認します。
2. **自宅の BOT を止めます**(Pterodactyl でサーバーを停止)。
3. 自宅で、データを書き出します。

   ```bash
   node scripts/export-db.mjs export.db
   ```
4. Railway に送ります。

   ```bash
   node scripts/upload-db.mjs export.db https://○○.up.railway.app <MIGRATION_TOKEN>
   ```
   `200 {"ok":true,...}` と出れば、成功です。
5. **データが消えないか確認します。** Railway で、一度 **Redeploy** を押して、終わったあと、同じ宛先に、もう一度 `upload-db.mjs` を実行します。`409 すでに引っ越し済みです` と返れば、ボリュームが効いています(印が残っている)。`400` なら、ボリュームに保存されていません(上の「2」を確認)。Railway 側が、自動で再起動して、データを入れ替えます(元のデータは、`bot.db.before-import-…` に残ります)。

## 5. BOT を動かす

1. Railway の Variables で、次のように変えます。
   - `DISCORD_TOKEN` を **追加**
   - `LUMI_NO_LOGIN` を **削除**
   - `MIGRATION_TOKEN` を **削除**(受け口を閉じる)
2. 再デプロイされ、ログに「ログイン」や、コマンドの登録が流れれば、動いています。
3. Discord で `/ping` を打って、動作を確認します(「バージョン」にコミット番号が出ます)。

## 6. ドメインを付け替える

1. Railway の **Settings → Networking → Custom Domain** に、`lumi.shishen575.net` を追加します。表示される **CNAME の宛先**を、控えます。
2. Cloudflare の DNS で、`lumi` の CNAME を、**Tunnel(`○○.cfargotunnel.com`)から、Railway の宛先に**変えます。最初は、**プロキシなし(灰色の雲)**にします。証明書が発行されたら、必要に応じて、プロキシ(オレンジの雲)を、SSL/TLS を「Full」にして有効にします。
3. Railway の `BASE_URL` を `https://lumi.shishen575.net` にします。
4. Developer Portal の **OAuth2 → Redirects** は、`https://lumi.shishen575.net/auth/callback` が、すでに入っていれば、そのままです。
5. ダッシュボードにログインして、動作を確認します。

## 7. あとしまつ

- 自宅の Pterodactyl の Lumi は、**止めたまま**にします(起動すると、トークンが二重になります)。テスト用に使うなら、**別の Discord アプリ(別のトークン)と別のデータ**にします。
- 自宅の Cloudflare Tunnel は、使わなくなります。
- GitHub の Webhook は、不要になります(このバージョンで、Webhook の機能自体を、削除しました)。Railway が、プッシュを見て、自動で更新します。GitHub の Settings → Webhooks に、古い設定が残っていれば、削除してください。

## うまくいかないとき

- **元に戻す:** Railway の `DISCORD_TOKEN` を消して(または、サービスを止めて)、自宅の BOT を起動し、ドメインの CNAME を Tunnel に戻します。
- **データの入れ替えを、やり直す:** `MIGRATION_TOKEN` を設定し直して(`LUMI_NO_LOGIN=1` も付けて、BOT は止めて)、`node scripts/upload-db.mjs export.db https://○○.up.railway.app <MIGRATION_TOKEN> --force` を実行します(一度引っ越しをしたあとは、`--force` がないと、受け付けません)。
