# Dogaria

犬のおしっこ記録による縄張り可視化アプリ（静的サイト）です。

## GitHub Pages 公開手順

1. このリポジトリを GitHub に push する。
2. デフォルトブランチを `main` にする（または workflow の対象ブランチを変更）。
3. GitHub の **Settings → Pages** で **Source: GitHub Actions** を選ぶ。
4. `main` に push すると、`.github/workflows/deploy-pages.yml` が実行され自動公開される。

公開URLの例:

- `https://<your-account>.github.io/<repo-name>/`

## ローカル起動

静的ファイルなので、`index.html` をブラウザで開くだけでも動作します。

（位置情報や一部APIは HTTPS 配信下でのみ正しく動く場合があります）
