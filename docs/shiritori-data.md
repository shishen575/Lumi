# しりとりの辞書データの取り方

しりとりの辞書は、次の4つから、できています。

| 元 | 内容 | 更新 |
|---|---|---|
| JMdict(`@johnmorrisdotca/kotoba`) | ルミの語彙 約5,900語 + 判定用 約9万語 | npm で更新 |
| kuromoji(IPA辞書) | 名詞の判定・漢字の読み | 固定 |
| `src/features/shiritori/theme.js` | ポケモン全1025種 + 手で集めた言葉 / 初音ミク関連 | 手で追加 |
| `src/features/shiritori/data/*.json` | 下のスクリプトで取った、追加の言葉(あれば、自動で、読み込む) | スクリプトを実行 |

## 追加の言葉を取る(無料・登録なし。はじめに、1回だけ)
まず、少しだけ、試す:
```bash
node scripts/fetch-pokemon.mjs --limit 30
```
問題なければ、全部:
```bash
npm run fetch:pokemon   # PokeAPI: 技・特性・道具・地名など → data/pokemon-extra.json
npm run fetch:miku      # VocaDB + 日本語Wikipedia: 曲・ボカロP → data/miku-extra.json
```
- 取った JSON を、コミットして、push すると、辞書に、入ります。
- 曲名の読みは、kuromoji で、推測します(`千本桜` → `せんぼんさくら` のように、濁点などが、ずれることがあります)。有名な言葉は、`theme.js` の手書きの読みが、優先されます。
- 外のサービスには、迷惑をかけないよう、同時4件・間隔つきで、取ります。

### 動作確認の状況(2026-11-19)
- `fetch-pokemon.mjs`: 実際の PokeAPI で確認ずみ。全部取って、**2,679語**(道具1,325・技911・特性312・地名86・性格25・タイプ20)を `data/pokemon-extra.json` に、入れてあります。
- `fetch-miku.mjs`: **まだ、実際の API では、確認できていません**(この作業の環境からは、VocaDB が応答せず、Wikipedia が回数制限で、断られました)。手元で、`--songs 30 --producers 10` のように、少しだけ試してください。
- 実行中の問い合わせ: Jisho.org は、実際の API で、確認ずみ。Wiktionary は、動きを、確認ずみ(Wikimedia の回数制限が、この環境からは、ひっかかるため、載っていない言葉の判定は、模擬のみ)。

## 実行中の、外の辞書への問い合わせ
辞書にない言葉は、ダッシュボードの「外の辞書に聞く」がオンなら、**Jisho.org**(非公式API)と**日本語版Wiktionary**に、言葉1語だけを、問い合わせます(1秒に1回まで・3.5秒で、あきらめる)。結果は、`shiritori_lookup` に保存して、同じ言葉は、二度と聞きません(「ない」は、1日)。

## 出典・ライセンス
JMdict © EDRDG(CC BY-SA 4.0)/ PokeAPI / VocaDB / Wikipedia(CC BY-SA)/ Jisho.org / Wiktionary(CC BY-SA)。ポケモン・初音ミクは、それぞれの権利者の、商標・著作物です(言葉の一覧としてのみ、使っています)。
