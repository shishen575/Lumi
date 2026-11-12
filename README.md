# Lumi

発言数・リアクション数・VC接続時間などの活動量に応じてロールを自動付与する Discord BOT。
複数サーバー対応で、条件とロールの組み合わせは **Webダッシュボード** から何パターンでも登録できます。

## 機能(activity-roles)
| 条件 | 内容 |
|---|---|
| 発言数 | メッセージ数(連投対策のクールダウンあり) |
| もらったリアクション数 | 自分の投稿に付いた数(自演・BOT除外) |
| つけたリアクション数 | 自分が付けた数 |
| VC接続時間(分) | AFKチャンネル・スピーカーミュート中は除外、「2人以上のとき」限定も可 |

- 同じ条件に複数ルールで段階(ランク)化。「下位ランクのロールを外す」で置き換え式にできる
- 過去の発言数をダッシュボードから取り込み(全チャンネル・スレッドを遡って集計し、現在値を上書き)。進捗はDBに保存され、再起動しても続きから再開可
- ロール付与時に通知チャンネルへ通知(文面はテンプレートで変更可、テスト送信つき)
- 既存の統計に新ルールを一括適用する「全員に適用」、ランキング表示つき
- 「ロールの管理」権限(または管理者・オーナー)を持つ人だけがそのサーバーを編集可。権限は操作のたびに確認し、自分の最上位ロールより上のロールはルールに設定できない(権限昇格の防止)

## Discord側の準備
1. Developer Portal でApplication作成 → Bot → **SERVER MEMBERS INTENT** を ON、トークン取得
2. OAuth2 → Client Secret 取得、Redirects に `BASE_URL/auth/callback` を登録
3. 招待リンク(管理者権限・スラッシュコマンド対応。ダッシュボードの「BOTを招待」ボタンも同じ内容):
   `https://discord.com/oauth2/authorize?client_id=<DISCORD_CLIENT_ID>&scope=bot%20applications.commands&permissions=8&integration_type=0`
4. BOTのロールは付与したいロールより**上**に配置(管理者権限でもロールの上下の制限は無視できない)

## ローカル起動
```bash
cp .env.example .env   # 値を記入
npm install
npm start              # http://localhost:3000
```
Node.js 22.13+ が必要(組み込みSQLite使用)。データは `data/bot.db`。

## 公開: Cloudflare Tunnel + Pterodactyl
1. Cloudflare Zero Trust → Networks → Tunnels でトンネル作成し **トークン** を控える
2. Public Hostname: `bot.example.com` → Service `http://localhost:<サーバーのポート>`
   (Pterodactylの割当ポート。BOT内で `SERVER_PORT` を自動使用)
3. このフォルダをGitリポジトリにpush(または後でファイルをアップロード)
4. パネル Admin → Nests → Import Egg で `deploy/egg-lumi.json` を取り込み
5. サーバー作成時に変数を入力: トークン類 / `BASE_URL=https://bot.example.com` / `TUNNEL_TOKEN` / `GIT_ADDRESS`
6. 起動するとBOTとダッシュボード、cloudflared(自動起動・自動再起動)が立ち上がる

ポート開放は不要(トンネルは外向き接続)。

## 新機能の追加方法
`src/features/<名前>/index.js` を作るだけで自動ロードされます。
```js
export default {
  name: 'welcome',            // APIは /api/guilds/:gid/f/welcome/...
  title: '歓迎メッセージ',
  ui: '/features/welcome.js', // 任意: ダッシュボードのタブ
  register({ client, router, db, getKV, setKV }) {
    client.on('guildMemberAdd', (m) => { /* ... */ });
    router.get('/config', (req, res) => res.json(getKV(req.guild.id, 'welcome', {})));
    router.put('/config', (req, res) => { setKV(req.guild.id, 'welcome', req.body); res.json({ ok: true }); });
  },
};
```
- `router` は管理権限チェック済みで `req.guild` が使える
- `getKV/setKV` はサーバー別の汎用設定ストア。専用テーブルは `core/db.js` の `migrate(sql)` で作成
- UIは `public/features/<名前>.js` で `Dash.registerTab({ name, render(el, ctx) })`(`ctx.api` `ctx.roles()` `ctx.channels()` `ctx.toast` 利用可。`public/features/activity-roles.js` が実例)
- 必要なIntentは `src/core/bot.js` に追加
- 無効化: 環境変数 `DISABLED_FEATURES=activity-roles,...`

## GitHub 連携の自動更新
`main` に push すると、サーバー上のLumiが自動で `git pull` → `npm install` → 再起動します。
1. パネルの変数: `AUTO_UPDATE=1`、`GITHUB_WEBHOOK_SECRET=<ランダムな文字列>`
2. GitHub リポジトリ → Settings → Webhooks → Add webhook
   - Payload URL: `https://<BASE_URL>/webhook/github`
   - Content type: `application/json`
   - Secret: 上と同じ値 / Events: `Just the push event`
3. push すると Recent Deliveries に 202 が返れば成功

仕組み: Webhookを署名検証(HMAC-SHA256)して終了コード42で終了 → `src/index.js`(監視役)が検知して、最新へ更新(`git fetch` + `reset --hard`)して再起動します。起動コマンドは `node src/index.js` だけでOKです。
非公開リポジトリは、clone時にURLへ読み取り専用トークンを含めておくと pull も通ります。

## スラッシュコマンド
| コマンド | 内容 |
|---|---|
| `/rank [user] [private]` | 自分(または指定ユーザー)の数・順位・ランク・次のランクまでの必要数 |
| `/top [metric] [page] [private]` | ランキングを10位ごとに表示(ボタンでページ送り。発言数・リアクション・VC時間) |
| `/help` | コマンド一覧と各機能の説明(自動生成) |

機能に `commands: [...]` と `help: '説明文'` を書くと、登録と `/help` への掲載が自動で行われます(`src/core/commands.js`)。
