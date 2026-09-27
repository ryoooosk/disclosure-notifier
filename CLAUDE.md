# disclosure-notifier

## コマンド実行

`pnpm` は sandbox から npm registry に到達できず、起動時の同一性検証で数分待たされた末に
`ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE` で失敗する。サブコマンドを問わず同じ。
検証は `./node_modules/.bin/` から直接実行すること。

```bash
./node_modules/.bin/biome check src/   # pnpm check 相当（--write は付けない）
./node_modules/.bin/tsc --noEmit       # pnpm typecheck 相当
```

`package.json` の `scripts` は人間と CI 用なので、この都合で書き換えない。
