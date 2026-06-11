# Development Guide

Mira (Tauri v2 + TypeScript Vanilla DOM + Rust) の開発者向けセットアップ手順、ローカル運用、トラブルシューティングをまとめる。

ユーザー向けの概要・機能説明は [README.md](README.md) を参照。

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Daily Development](#daily-development)
- [Lint, Format, Test](#lint-format-test)
- [Local Data Layout](#local-data-layout)
- [Resetting the Local Database](#resetting-the-local-database)
- [WebView2 DevTools](#webview2-devtools)
- [Known Pitfalls](#known-pitfalls)
- [Editor Setup](#editor-setup)
- [FAQ](#faq)
- [関連ドキュメント](#関連ドキュメント)

---

## Prerequisites

| Tool                      | Version                             | Notes                                                                                     |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Node.js                   | 22.12.0 (`.nvmrc`)                  | `nvm-windows` または `fnm` で `nvm use` できる                                            |
| npm                       | Node.js 同梱版                      | Corepack による pnpm/yarn 切替は未使用                                                    |
| Rust (stable)             | `src-tauri/rust-toolchain.toml`     | `rustup` 導入後に `cd src-tauri` で自動 install                                           |
| Visual Studio Build Tools | 2022 / Desktop development with C++ | `winreg` / `rusqlite (bundled)` のビルドに必要                                            |
| Microsoft Edge WebView2   | Windows 10 1809+ は OS 同梱         | 任意で [Evergreen Bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/) |
| Windows SDK               | 10/11 用最新                        | Visual Studio Installer の「C++ build tools」と同梱                                       |

オプション:

- [Tauri CLI extension for VS Code](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) — 開発体験を向上。
- [SQLite Browser](https://sqlitebrowser.org/) — `mira.db` を直接確認する場面で便利。

---

## Initial Setup

```powershell
# 1. リポジトリ clone
git clone <repo-url> mira
cd mira

# 2. Node のバージョン合わせ (nvm-windows の場合)
nvm install 22.12.0
nvm use 22.12.0

# 3. 依存関係インストール
npm install

# 4. Tauri 開発ビルドで起動
npm run tauri dev
```

`npm run tauri dev` 初回は Rust のクレート解決に数分かかる。`src-tauri/rust-toolchain.toml` に応じて `rustup` が必要 toolchain を自動取得する。

### StellaRecord DB の用意

Mira は読み取り専用で StellaRecord DB を参照する。開発時は以下のいずれかで DB を確保すること。

1. [StellaRecord](https://github.com/cosmoartsstore-private/stellarecord) を別途インストールして実行 → `%LOCALAPPDATA%\Programs\StellaRecord\Data\db\stellarecord.db` が生成される。
2. 設定画面 ("StellaRecord 連携") から手動で DB ファイルパスを指定する。

DB 未検出のときも Mira は起動可能だが、訪問・写真・同席ユーザー情報は空になる。

---

## Daily Development

| Command               | 用途                                            |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | Vite dev server 単独 (ポート 1421 固定)         |
| `npm run tauri dev`   | Vite + Tauri 同時起動 (通常の開発フロー)        |
| `npm run build`       | `tsc -b` + `vite build` (型検査 + フロント本番) |
| `npm run tauri build` | NSIS インストーラを生成                         |

### ポート 1421 が既に占有されている場合

`vite.config.ts` の `server.strictPort: true` により別ポートにフォールバックしない。
別アプリで 1421 を占有している場合は **必ず以下 3 箇所を同じ値に揃える**。

- `vite.config.ts` の `server.port` / `server.hmr.port`
- `src-tauri/tauri.conf.json` の `build.devUrl`
- `src-tauri/tauri.conf.json` の CSP `connect-src` (`http://localhost:<port>` / `ws://localhost:<port>`)

詳細は [README.md → Dev Server Port](README.md#dev-server-port)。

---

## Lint, Format, Test

| Command                      | 内容                                               |
| ---------------------------- | -------------------------------------------------- |
| `npm run lint`               | ESLint (typescript-eslint strict + unicorn)        |
| `npm run format`             | Prettier で `**/*.{ts,js,json,md,css,html}` を整形 |
| `npm run format:check`       | Prettier のチェックのみ (CI で使用)                |
| `npm run stylelint`          | Stylelint (`src/**/*.css`)                         |
| `npm run stylelint:fix`      | Stylelint auto-fix                                 |
| `npm run build`              | TypeScript 型検査 (`tsc -b`) + Vite 本番ビルド     |
| `cd src-tauri; cargo clippy` | Rust lint (unwrap/expect/panic = `deny`)           |
| `cd src-tauri; cargo fmt`    | Rust auto-format                                   |
| `cd src-tauri; cargo test`   | Rust 単体テスト (存在するモジュールのみ)           |

CI 相当のローカル一括チェックは以下:

```powershell
npm run lint; if ($?) { npm run format:check; if ($?) { npm run stylelint; if ($?) { npm run build } } }
cd src-tauri; cargo fmt --check; if ($?) { cargo clippy --all-targets -- -D warnings }
```

---

## Local Data Layout

| Path                                                        | Purpose                               |
| ----------------------------------------------------------- | ------------------------------------- |
| `%LOCALAPPDATA%\Programs\Mira\Data\db\mira.db`              | Mira 本体 DB (メモ / 予定 / マーカー) |
| `%LOCALAPPDATA%\Programs\Mira\Data\db\mira.db-wal` / `-shm` | SQLite WAL ジャーナル                 |
| `%LOCALAPPDATA%\Programs\Mira\Data\archive\`                | アーカイブ済み DB スナップショット    |
| `%LOCALAPPDATA%\Programs\Mira\Data\logs\panic.log`          | Rust panic / 起動失敗ログ             |
| `%LOCALAPPDATA%\Programs\Mira\Data\EBWebView\`              | WebView2 ユーザーデータ (Cookie 等)   |
| `HKCU\Software\CosmoArtsStore\Mira`                         | インストール場所 / 起動関連レジストリ |

開発ビルド (`npm run tauri dev`) でも上記と同じパスを利用する。インストール済み Mira とは DB を共有するため、開発時に本番データを上書きしないよう注意すること。

### Mira DB を別パスに切り替えたい場合

`src-tauri/src/db/mira_db.rs` の `data_dir()` を直接編集するのではなく、開発時はユーザープロファイルを別アカウントに切り替えるか、`Data/db/mira.db` をバックアップして空 DB から開始するのが安全。

---

## Resetting the Local Database

メモ・予定・マーカーをすべてクリアして初期状態から検証したい場合:

```powershell
# 1. Mira を完全に終了 (タスクトレイ含む)
Stop-Process -Name "mira" -Force -ErrorAction SilentlyContinue

# 2. DB ファイルを削除
Remove-Item "$env:LOCALAPPDATA\Programs\Mira\Data\db\mira.db*" -Force -ErrorAction SilentlyContinue

# 3. 任意でログも消す
Remove-Item "$env:LOCALAPPDATA\Programs\Mira\Data\logs\*" -Force -ErrorAction SilentlyContinue

# 4. 再起動 (空 DB が自動生成される)
npm run tauri dev
```

WAL モードで動作しているため `mira.db-wal` / `mira.db-shm` の併削が必要。

---

## WebView2 DevTools

Tauri は dev / debug ビルドのときのみ WebView2 の右クリックメニューから DevTools を開ける。

1. アプリ上で右クリック → "検証" (Inspect)
2. F12 でも開閉可能 (Tauri v2 では debug build で有効)

`npm run tauri build` のリリースビルドでは DevTools が無効化されるため、リリース版の検証には `tauri build --debug` を利用する。

---

## Known Pitfalls

### OS タイムゾーン変更時はアプリ再起動が必要

バックエンドは起動時に `chrono::Local` のタイムゾーン情報をスナップショットして利用する。
OS のタイムゾーンを Mira 起動中に変更した場合、変更内容はアプリ再起動後に反映される。
リマインダー発火時刻や日付境界の判定がズレる可能性があるため、タイムゾーン変更時は Mira を一度終了してから再起動すること。

### `npm run tauri dev` が白い画面になる

`vite` が 1421 ポートを取得できず別ポートにフォールバックしている可能性。
PowerShell で `netstat -ano | findstr :1421` を実行し、占有プロセスを終了させてから再起動する。

### `cargo clippy` で `unwrap_used` エラー

`src-tauri/Cargo.toml` の `[lints.clippy]` で `unwrap_used = "deny"` を設定している。
新規コードは `?` 演算子もしくは明示的なエラー処理に置き換えること。テストコード内でも同じ制約が適用される。

### `rusqlite` のリンクエラー

`bundled` feature が有効化されているため通常は OS の SQLite を参照しない。
それでもリンクエラーが出る場合は Visual Studio Build Tools の「C++ Build Tools」と「Windows SDK」が入っているか確認する。

### WebView2 が未インストールの環境

Windows 10 1809 未満や WebView2 を明示的にアンインストールした環境では、Tauri 起動時に DLL ロード失敗で落ちる。Microsoft の [Evergreen Bootstrapper](https://developer.microsoft.com/microsoft-edge/webview2/) で WebView2 Runtime を入れること。

### `cargo` のターゲットフォルダが肥大化する

`src-tauri/target/` は数 GB に達する。週次で `cargo clean` を推奨。
削除後の初回ビルドは 5〜10 分かかる点に注意。

---

## Editor Setup

`.vscode/` 配下に共有設定をコミットしている。VS Code を開いた際に推奨拡張のインストールが提案される。

- `.vscode/settings.json` — Prettier / ESLint / Stylelint / rust-analyzer の workspace 設定
- `.vscode/extensions.json` — 推奨拡張 (ESLint, Prettier, Stylelint, rust-analyzer, Tauri, Even Better TOML, CodeLLDB)
- `.vscode/launch.json` — Tauri dev/release の Rust デバッグ起動設定 (要 CodeLLDB)
- `.vscode/tasks.json` — `ui:dev` / `ui:build` / `tauri:dev` / `lint`

別エディタを使う場合は最低限以下を有効化することを推奨:

- 保存時 Prettier フォーマット
- ESLint flat config (`eslint.config.js`) の認識
- rust-analyzer に `src-tauri/Cargo.toml` を linked project として登録

---

## FAQ

### Q. DB をリセットしたい

`%LOCALAPPDATA%\Programs\Mira\Data\db\mira.db` (および `mira.db-wal` / `mira.db-shm`) を削除すれば、次回起動時に空 DB が再生成される。詳細手順は [Resetting the Local Database](#resetting-the-local-database) を参照。

```powershell
Stop-Process -Name "mira" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:LOCALAPPDATA\Programs\Mira\Data\db\mira.db*" -Force
```

### Q. `panic.log` の場所はどこ?

`%LOCALAPPDATA%\Programs\Mira\Data\logs\panic.log` に出力される。Rust の panic / 起動失敗時に追記される。

```powershell
notepad "$env:LOCALAPPDATA\Programs\Mira\Data\logs\panic.log"
```

### Q. Vite dev server のポート 1421 が他プロセスと衝突する

`vite.config.ts` の `server.port` を変更し、合わせて以下 3 箇所も同じ値に揃える。

- `vite.config.ts` の `server.port` / `server.strictPort` / `server.hmr.port`
- `src-tauri/tauri.conf.json` の `build.devUrl`
- `src-tauri/tauri.conf.json` の CSP `connect-src` (`http://localhost:<port>` / `ws://localhost:<port>`)

詳細は [README.md → Dev Server Port](README.md#dev-server-port)。

### Q. rust-analyzer が遅い / メモリを食う

`.vscode/settings.json` の `rust-analyzer.cargo.features` で features を絞り、`rust-analyzer.checkOnSave.command` を `clippy` から `check` に下げると軽量化できる。例:

```json
{
  "rust-analyzer.cargo.features": [],
  "rust-analyzer.checkOnSave.command": "check",
  "rust-analyzer.procMacro.enable": true,
  "rust-analyzer.cargo.buildScripts.enable": true
}
```

`src-tauri/target/` を `cargo clean` で削除した直後はインデックス再構築で一時的に重くなる。

---

## 関連ドキュメント

- [README.md](README.md) — ユーザー向け概要・機能説明・インストール手順
- [docs/spec.md](docs/spec.md) — 機能仕様書 (IPC API、データフロー、並行性モデル)
- [docs/database.md](docs/database.md) — Mira DB スキーマ定義
- [docs/tech-stack.md](docs/tech-stack.md) — 技術スタック詳細と ADR
- [CHANGELOG.md](CHANGELOG.md) — リリース履歴
