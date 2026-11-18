# 外のサイトとの連携(相手側の実装ガイド)

1. サーバーの管理者が、Lumi の `/integration create name:<名前>`(またはダッシュボードの「連携」)で、**接続用トークン**を発行します(1回だけ表示・15分で失効)。
2. 相手のサイトが、トークンと「使いたい機能」を送ります。

```
POST https://<Lumiのアドレス>/internal/register
{ "token": "lumi_…",
  "manifest": {
    "name": "ご当地めし帖", "description": "店の共有サイト",
    "capabilities": ["notify", "members", "rank", "grant"],
    "settings": [ { "key": "min_posts", "type": "number", "label": "付与する投稿数", "help": "…" } ] } }
→ 200 { "integrationId": "int_…", "secret": "…(この1回だけ)", … }
```

- `capabilities` は許可リスト(`notify` お知らせ投稿 / `members` メンバー確認 / `rank` 活動ランク / `grant` ロール付与)だけ。ほかは捨てられます。
- `settings` の `type` は `channel` `role` `toggle` `text` `number`。Lumi のダッシュボードに、設定の画面が自動でできます。管理者が選んだ値は `GET /internal/settings` で読めます(チャンネル・ロールのIDは返しません)。
- 管理者が、ダッシュボードで機能をオンにし、チャンネル・ロールを選ぶまで、各APIは 403 です。宛先のチャンネル・ロールは、リクエストでは指定できません。

3. 以降の呼び出しは、署名つきです。

```
X-Integration-Id: int_…
X-Timestamp: <ミリ秒。60秒を超えて古い/先のものは401>
X-Signature: HMAC-SHA256(secret, X-Timestamp + "." + 本文) の16進
```
同じ署名の再送は 409。

| 機能 | API |
|---|---|
| `notify` | `POST /internal/meshi-notify` `{ "embed": { title, url, description, fields, author:{name}, timestamp, image:{url} }, "route"?, "thread"? }`(下の「宛先」) |
| `members` | `GET /internal/members/:discordUserId` → `{ member, roles, joinedAt }`(なければ404) |
| `rank` | `GET /internal/users/:discordUserId/rank` → `{ messages, rankRole, rankRoleId }`(なければ404) |
| `grant` | `POST /internal/roles/grant` `{ "userId", "reason" }` → `{ ok, already? }` |

## 宛先(`notify` の `route` と `thread`)
- `route`(任意): `hokkaido_tohoku` / `kanto` / `chubu` / `kinki` / `chugoku_shikoku` / `kyushu_okinawa`。manifest の `settings` に、`type: "channel"` で `channel_<route>` を入れておくと、管理者が地域ごとの投稿先を選べます。選ばれていない地域・不正な `route` は、通常の通知先に送ります。
- `thread`(任意): 名前(100文字まで。改行・メンションは取り除きます)。manifest の `settings` に `thread_by_pref`(`toggle`)があり、管理者がオンにしていれば、選ばれたチャンネルの中で、同じ名前のスレッドを探して投稿します。なければ、公開スレッドを作ります(フォーラムなら、その名前の投稿を作ります)。作れない・見つからないときは、スレッドなしでチャンネルに送ります。
- 宛先のチャンネルIDは、リクエストでは指定できません(`GET /internal/settings` も、チャンネル・ロールの項目は、ID ではなく「選ばれているか(true/false)」だけを返します)。
- 返事: `{ "ok": true, "thread": true/false, "created": true/false, "routed": true/false }`。
- `settings` は最大16件、`embed.image.url` は https のみ。
