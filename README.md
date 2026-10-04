# disclosure-notifier

TDnet の適時開示と EDINET の法定開示を 1 日 1 回チェックし、ウォッチリストに入れた銘柄のものだけをメールで通知する。

開発中。GitHub Actions の cron で毎日 17:30 JST に実行する。

## 必要なもの

- Node.js 26（`.nvmrc`）
- pnpm（`corepack enable` で `packageManager` のバージョンが入る）

## セットアップ

1. pnpm と依存関係のインストール

```bash
npm i -g corepack
corepack enable
pnpm install
```

1. 設定ファイルの用意

```bash
cp src/data-source/watchlist/watchlist.example.jsonc src/data-source/watchlist/watchlist.jsonc
cp .env.example .env
```

## 実行

```bash
node --env-file=.env src/index.ts
```

普段はこれだけでよい。TDnet は実行した日（JST）の分を、EDINET は直前 24 時間に検知された分を見る。

取りこぼした過去の日をやり直すときだけ、`--scheduled-at` でその日付を渡す。
その日の 17:30 JST に定時実行した場合と同じ範囲を処理する。

```bash
node --env-file=.env src/index.ts --scheduled-at 2026-09-28
```

## GitHub Actions

[.github/workflows/disclosure-notifier.yml](.github/workflows/disclosure-notifier.yml) が毎日 17:30 JST に実行する。
`watchlist.jsonc` と `.env` はリポジトリに無いので、以下を登録しておく必要がある。

| 名前 | 種別 | 内容 |
| --- | --- | --- |
| `WATCHLIST_JSONC` | Secret | `watchlist.jsonc` の中身そのまま |
| `RESEND_API_KEY` | Secret | Resend の API キー |
| `EMAIL_TO` | Secret | 通知先アドレス |
| `EMAIL_FROM` | Variable | 送信元アドレス（Phase 1 は `onboarding@resend.dev`） |

```bash
gh secret set WATCHLIST_JSONC < src/data-source/watchlist/watchlist.jsonc
gh secret set RESEND_API_KEY
gh secret set EMAIL_TO
gh variable set EMAIL_FROM
```

監視銘柄を入れ替えたら `WATCHLIST_JSONC` の更新を忘れないこと。忘れても失敗せず、
古いウォッチリストのまま通知が届き続ける。

取りこぼした日を後から処理するときは、基準時刻を指定して手動実行する。
cron で起動した run を後日 re-run すると、re-run した時点から基準時刻を決め直すので使わない。

```bash
gh workflow run disclosure-notifier.yml -f scheduled_at=2026-09-28
```

なお、60 日間リポジトリに活動がないと GitHub 側で cron が自動停止する。
止まったら Actions の画面から手動で再有効化する。

## 取得先への配慮

TDnet の一覧ページは 1 秒以上の間隔を空け、User-Agent にこのリポジトリの URL を付けて取得している
（[src/lib/fetch-client.ts](src/lib/fetch-client.ts)）。fork して動かす場合は cron の頻度を上げすぎないこと。
TDnet の利用条件は各自で確認すること。

## ライセンス

ライセンスは設定していない（全権利留保）。閲覧・参考は自由だが、再配布や再利用は想定していない。
