# Static site (sukusuku-lab.com)

フコク赤ちゃん＆キッズクラブを応援・解説する非公式ファンサイトの静的サイト一式です。

## 構成

```
index.html          トップページ（要点・特典カード・正直レビューへの導線）
review/index.html   正直レビュー（メリット7・デメリット5・FAQ、FAQPage/Article構造化データ入り）
guide/index.html    入会ガイド（資格・手順・退会ルール、HowTo構造化データ入り）
about/index.html    当サイトについて（運営者情報・編集方針・免責）
assets/style.css    共通スタイル（ライト/ダーク対応）
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
