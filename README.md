# Static site (sukusuku-lab.com)

Static HTML/CSS site deployed via GitHub Pages.

<details>
<summary>Notes (JA)</summary>

非公式ファンサイトの静的サイト一式です。

## 構成

```
index.html          トップページ（要点・特典カード・正直レビューへの導線）
review/index.html   正直レビュー（メリット7・デメリット5・FAQ、FAQPage/Article構造化データ入り）
guide/index.html    入会ガイド（資格・手順・退会ルール、HowTo構造化データ入り）
about/index.html    当サイトについて（運営者情報・編集方針・免責）
assets/style.css    共通スタイル（ライト/ダーク対応）
world-capitals/     学習ミニアプリ「世界の国と首都をおぼえよう」（小学校高学年向け・30か国）
                    index.html / style.css / countries.js（学習データ）/ map-data.js（世界地図パス）/ app.js
                    ※サイト本体とは独立したページ。ナビゲーション・sitemap には未掲載
robots.txt          クローラー許可設定（AIボット明示許可）
llms.txt            AI向けサイト要約
sitemap.xml         サイトマップ
```

## 公開手順（GitHub Pages）

1. GitHubで新しいリポジトリ（例: `sukusuku-club-site`）を作成
2. このフォルダで:
   ```sh
   git init
   git add .
   git commit -m "初回公開"
   git branch -M main
   git remote add origin https://github.com/＜ユーザー名＞/sukusuku-club-site.git
   git push -u origin main
   ```
3. リポジトリの Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `(root)` に設定
4. 数分後 `https://＜ユーザー名＞.github.io/sukusuku-club-site/` で公開されます

## 公開前チェックリスト

- [ ] `robots.txt` と `sitemap.xml` の `YOUR-USERNAME` を実際のURLへ書き換える
- [ ] `about/index.html` の運営者名・連絡先を記入する
- [ ] 各ページの「最終更新」日付を更新する（内容を変えたとき）
- [ ] Google Search Console にサイトマップを登録する（検索・AI検索双方に有効）

## source アウトレット新着監視（GitHub Actions）

`.github/workflows/source-outlet.yml` が毎日 2:46 JST に
https://www.source-jp.com/view/category/ct87 をチェックし、新着商品があれば要約付きで Gmail 送信します。
要約は外部APIを使わず、商品名・価格・商品ページの説明文から機械的に作成します（APIキー不要）。

- スクリプト: `scripts/check_source_outlet.py`（`--dry-run` で送信せず本文を表示）
- 前回の取得状態: `data/source-outlet.json`（ワークフローが自動コミット）
- 初回実行時は「監視開始」として現在の掲載商品一覧を1通送り、以降は新着のみ送信

### 必要な Secrets（Settings → Secrets and variables → Actions）

| 名前 | 内容 |
|---|---|
| `GMAIL_USER` | 送信元 Gmail アドレス |
| `GMAIL_APP_PASSWORD` | Gmail のアプリパスワード（Google アカウントで2段階認証を有効化 → 「アプリパスワード」で発行） |
| `MAIL_TO` | 送信先アドレス（カンマ区切りで複数可） |

設定後、Actions タブから「source アウトレット新着監視」を手動実行（Run workflow）すると動作確認できます。

</details>
