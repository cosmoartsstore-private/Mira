# Mira

[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6)](https://www.microsoft.com/windows)
[![Tauri](https://img.shields.io/badge/Tauri-2.11-24C8DB)](https://tauri.app/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/license-Proprietary-lightgrey)](#license)

VRChat の活動を振り返るジャーナルアプリケーション。StellaRecord の SQLite データベースから訪問履歴・出会い・写真を読み取り、タイムライン形式と日次メモで可視化する Windows デスクトップアプリケーション。

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Screenshots](#screenshots)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Build from Source](#build-from-source)
- [Project Structure](#project-structure)
- [Data and Privacy](#data-and-privacy)
- [Security](#security)
- [Known Limitations](#known-limitations)
- [Documentation](#documentation)
- [Acknowledgements](#acknowledgements)
- [License](#license)

---

## Overview

Mira は VRChat の活動ログを「振り返り」のための形式に変換するコンパニオンアプリケーションである。VRChat の生ログを直接解析するのではなく、姉妹アプリ StellaRecord が正規化した SQLite データベースを読み取り専用で参照する設計をとる。

タイムラインの可視化は週単位で行い、ワールド訪問は世界名から決定論的に生成した色付きブロックでレーンに描画する。1 日を選択するとフォーカスビューに切り替わり、訪問・同席ユーザー・写真・ユーザーメモを 1 枚の紙面として再構成する。

メモは自由記述で、本文中のワールド名・ユーザー名は自動的に下線マーカーとしてハイライトされる。「めもきっと」と呼ぶロール紙風ステッカーパレットから、観測済みの名前をワンクリックで挿入できる。

季節ごとの「Mira スナップショット」では、四半期と年間の振り返りを封筒開封演出付きのモーダルとして提示する。

外部サーバとの通信は行わない。すべてのデータはローカルファイルシステム上の SQLite と Windows レジストリにのみ格納される。

---

## Features

- **週間タイムライン** — 月曜始まり 7 日分のワールド訪問レーンを描画。Shift + マウスホイールで時間軸を 1〜24 時間レンジに拡縮可能。
- **日次フォーカスビュー** — 選択日の訪問ブロック・同席ユーザー・写真・メモを 1 画面に統合表示。
- **日次メモ** — ワールド名・ユーザー名の自動ハイライトとユーザー手動マーカー (4 色) に対応。1 秒のデバウンス自動保存。
- **めもきっと** — その日に観測した名前から動的に生成されるロール紙風ステッカーパレット。クリックでメモに挿入。
- **コルクボード写真ギャラリー** — 訪問ブロッククリックで時間帯フィルタが効くサムネイル一覧。Lightbox で原寸表示。
- **Mira スナップショット** — 季節ごとに四半期サマリーと年間レビューを封筒開封演出で表示。
- **予定通知ピン** — ユーザー登録イベントをタイムラインレーン上にピン表示。起動時には今日〜1 週間以内の予定をリマインダーカードに集約。
- **リマインダー** — 30 秒間隔のポーリングで指定時刻にチャイム + トースト + (任意で) VOICEVOX 音声を再生。指数バックオフで一時的な失敗から自動復帰。
- **カレンダー** — 月別カレンダーで活動日・祝日・予定を可視化。日本の祝日 (ハッピーマンデー・振替休日対応) は内蔵テーブルから算出。
- **ページ遷移演出** — タブ切替時にスライドカバーで前後ページのチラつきを隠す (設定で無効化可能)。
- **書体カスタマイズ** — 手書き風日本語フォント 4 種から選択。メモのみ / アプリ全体の適用範囲切替に対応。
- **StellaRecord 連携** — 初回起動時に StellaRecord の `apps` テーブルへ自動登録し、StellaRecord のランチャーから 1 クリック起動できる。

---

## Screenshots

スクリーンショットは現在準備中。`docs/images/` 配下に画像を配置後、以下の表を有効化する予定である。

<!--
配置予定 (準備中):

| Weekly Timeline | Day Focus |
| --------------- | --------- |
| ![Weekly](docs/images/weekly.png) | ![Day Focus](docs/images/day-focus.png) |

| Calendar | Snapshot |
| -------- | -------- |
| ![Calendar](docs/images/calendar.png) | ![Snapshot](docs/images/snapshot.png) |
-->

---

## Tech Stack

### Frontend

| Layer        | Technology                                                                                                    | Version |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------- |
| Language     | TypeScript                                                                                                    | 5.9     |
| UI Framework | Vanilla DOM + 自作リアクティブストア                                                                          | -       |
| Build Tool   | Vite                                                                                                          | 7.3.1   |
| Tauri SDK    | @tauri-apps/api                                                                                               | 2.11.0  |
| Styling      | CSS Custom Properties + CSS Animations                                                                        | -       |
| Fonts        | Google Fonts (Allura / Cormorant Garamond / Noto Sans JP / Yomogi / Yusei Magic / Kiwi Maru / Hachi Maru Pop) | -       |

React 等の UI フレームワークは採用していない。状態管理は自作の `Store<T>` クラスで、`Set<Listener>` ベースの最小実装。

### Backend

| Layer                 | Technology                | Version      |
| --------------------- | ------------------------- | ------------ |
| Language              | Rust                      | Edition 2021 |
| Application Framework | Tauri                     | 2.11.0       |
| Database              | rusqlite (bundled SQLite) | 0.38         |
| Date/Time             | chrono                    | 0.4          |
| Registry I/O          | winreg                    | 0.52         |
| Serialization         | serde                     | 1.0          |

### Distribution

| Layer        | Technology                |
| ------------ | ------------------------- |
| Installer    | NSIS (Tauri Bundler 経由) |
| Install Mode | currentUser               |
| Code Signing | 未実装                    |

技術選定の詳細と意思決定記録は [docs/tech-stack.md](docs/tech-stack.md) を参照。

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Windows 10 / 11 (x64)                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                Mira.exe (Tauri v2)                  │    │
│  │                                                     │    │
│  │   WebView2 (Chromium)             Rust Backend      │    │
│  │   ─────────────────────────       ───────────────   │    │
│  │   TypeScript + Vanilla DOM   ◀──▶ Tauri 2.11        │    │
│  │   Vite 7                  IPC     rusqlite 0.38     │    │
│  │   Reactive Store<T>               chrono 0.4        │    │
│  │   CSS Variables (4 memo fonts)    winreg 0.52       │    │
│  │                                                     │    │
│  └────────────────────────┬────────────────────────────┘    │
│                           │                                 │
│       ┌───────────────────┴────────────────────┐            │
│       ▼                                        ▼            │
│   ┌──────────────────────┐       ┌──────────────────────┐   │
│   │ Mira DB (WAL)        │       │ StellaRecord DB      │   │
│   │ Data/db/mira.db      │       │ (read-only)          │   │
│   │   - journal / memo   │       │ Data/db/             │   │
│   │   - events           │       │   stellarecord.db    │   │
│   │   - markers / colors │       └──────────────────────┘   │
│   └──────────────────────┘                                  │
│                                                             │
│   Windows Registry: HKCU\Software\CosmoArtsStore\Mira       │
└─────────────────────────────────────────────────────────────┘
```

詳細なモジュール構成・データフロー・並行性モデルは [docs/spec.md](docs/spec.md) を参照。

---

## Requirements

### Runtime

- Windows 10 (1809 以降) または Windows 11 (x64)
- Microsoft Edge WebView2 Runtime (Windows 10 1809 以降は OS 標準同梱)
- [StellaRecord](https://github.com/cosmoartsstore-private/stellarecord) のインストール (DB ファイルが必要)
- 約 50 MB のディスク空き容量 (ボイスアセット込み)

### Build

- [Node.js](https://nodejs.org/) 20.19 以上、または 22.12 以上 (Vite 7 の要求)
- [Rust](https://rustup.rs/) toolchain (stable、edition 2021)
- Windows SDK (`winreg` crate のビルドに必要)

---

## Installation

### From Installer

1. Releases ページから最新の `Mira_Setup.exe` をダウンロード
2. インストーラを実行
3. 既定のインストール先は `%LOCALAPPDATA%\Programs\Mira`

管理者権限は不要。

### Uninstallation

Windows の「アプリと機能」から `Mira` をアンインストールする。

#### アンインストール時のデータ取り扱い

NSIS インストーラ (`src-tauri/windows/installer.nsi`) は、誤削除リスクを抑えるためユーザーが入力した情報を既定で残す方針をとる。

| パス                                           | 動作 | 内容                                              |
| ---------------------------------------------- | ---- | ------------------------------------------------- |
| `%LOCALAPPDATA%\Programs\Mira\Data\db\mira.db` | 保持 | メモ・予定・手動マーカー・カスタム色 (再生成不可) |
| `%LOCALAPPDATA%\Programs\Mira\Data\archive\`   | 保持 | アーカイブ済みの旧データ                          |
| `%LOCALAPPDATA%\Programs\Mira\Data\logs\`      | 削除 | アプリログ (再生成可)                             |
| `%LOCALAPPDATA%\Programs\Mira\Data\EBWebView\` | 削除 | WebView2 ユーザーデータキャッシュ                 |
| `%APPDATA%\com.cosmoartsstore.mira\`           | 削除 | Tauri が自動生成する AppData ミラー (現状未使用)  |
| `%LOCALAPPDATA%\com.cosmoartsstore.mira\`      | 削除 | 同上                                              |
| `HKCU\Software\CosmoArtsStore\Mira`            | 削除 | インストール場所レジストリ                        |
| `HKCU\Software\CosmoArtsStore\${PRODUCTNAME}`  | 削除 | 言語設定など Tauri 標準キー                       |
| `HKCU\...\Uninstall\${PRODUCTNAME}`            | 削除 | アンインストール情報                              |
| `HKCU\...\Run` のオートスタートエントリ        | 削除 | 起動時自動実行設定 (登録されていれば)             |
| スタートメニュー / デスクトップショートカット  | 削除 | `${PRODUCTNAME}.lnk` (アップデート時を除く)       |
| ファイル関連付け / Deep Link プロトコル        | 削除 | 設定されている場合のみ                            |

#### データを完全に削除する

アンインストール後に `mira.db` 等を完全に削除したい場合は、エクスプローラから以下を手動で削除する。

```
%LOCALAPPDATA%\Programs\Mira\
```

このフォルダごと削除すれば、メモ・予定・マーカー・アーカイブを含む全てのローカルデータが消去される。

---

### データバックアップ

アプリ終了後、以下のファイルを任意の場所にコピーしておくことで、メモ・予定・マーカー等を保全できる。

```
%LOCALAPPDATA%\Programs\Mira\Data\db\mira.db
```

復元時は Mira を完全に停止した状態で同じパスに上書きコピーする。WAL モードを利用しているため、コピー時に `mira.db-wal` / `mira.db-shm` も存在する場合は併せてコピーすると確実である (アプリ停止中であれば WAL は通常チェックポイント済みのため `mira.db` 単体で十分なケースが多い)。

別 PC への移行や別アカウントへの引き継ぎにも同じ手順を利用できる。

---

## Build from Source

```bash
# 依存関係のインストール
npm install

# 開発ビルド (Vite dev server + Tauri dev)
npm run tauri dev

# 本番ビルド (NSIS インストーラを生成)
npm run tauri build
```

ビルド成果物は `src-tauri/target/release/bundle/nsis/` に出力される。

開発環境セットアップの詳細 (Node.js / Rust / Visual Studio Build Tools / WebView2 等の前提、ローカル DB のリセット方法、エディタ設定、lint/format コマンド、既知の落とし穴) は [DEVELOPMENT.md](DEVELOPMENT.md) を参照。

#### Dev Server Port

`src-tauri/tauri.conf.json` の `build.devUrl` は `http://localhost:1421` 固定である。`vite.config.ts` の `server.port` も同じ値に揃えており、`strictPort: true` のため別ポートへのフォールバックは行わない。別プロセスが 1421 を占有している場合は占有プロセスを終了するか、以下 3 箇所を同じ値に揃えて変更する。

- `vite.config.ts` の `server.port` および `server.strictPort`
- `src-tauri/tauri.conf.json` の `build.devUrl`
- `src-tauri/tauri.conf.json` の CSP `connect-src` (`http://localhost:<port>` / `ws://localhost:<port>`)

### Lint and Format

```bash
npm run lint          # ESLint (typescript-eslint strict)
npm run format        # Prettier
npm run stylelint     # Stylelint
cargo clippy          # Rust clippy (unwrap/expect/panic = deny)
```

詳細な開発フローと運用 Tips は [DEVELOPMENT.md](DEVELOPMENT.md) にまとめている。

---

## Project Structure

```
.
├── src/                       Frontend (TypeScript, Vanilla DOM)
│   ├── main.ts                エントリポイント
│   ├── app.ts                 起動シーケンス・タブ切替・遷移演出統括
│   ├── api/                   Tauri invoke ラッパー
│   ├── state/                 リアクティブストア・型定義
│   ├── pages/                 ページコンポーネント
│   │   ├── home/              週間タイムライン + 日次フォーカス
│   │   ├── calendar/          月別カレンダー + 予定 CRUD
│   │   ├── settings/          設定 + クレジット
│   │   └── debug/             デバッグパネル (DEV ビルドのみ)
│   ├── components/            共通 UI 部品 (Navbar / StartupReminder / SnapshotModal)
│   ├── animations/            遷移・季節サマリー・封筒演出
│   ├── services/              リマインダーポーリング
│   ├── utils/                 datetime / html / toast / 祝日テーブル
│   ├── styles/                CSS モジュール
│   └── assets/                テクスチャ / 通知音 / VOICEVOX 音声 / アバター
├── src-tauri/                 Backend (Rust)
│   ├── src/
│   │   ├── main.rs            エントリポイント
│   │   ├── lib.rs             Tauri 起動と IPC ハンドラ登録
│   │   ├── commands/          Tauri IPC コマンドハンドラ
│   │   │   ├── journal.rs     週レーン / 日次データ / メモ / マーカー
│   │   │   ├── calendar.rs    月別データ / 予定 CRUD
│   │   │   ├── settings.rs    設定 CRUD
│   │   │   ├── reminder.rs    期限到来リマインダー取得
│   │   │   ├── snapshot.rs    四半期 / 年間レビュー集計
│   │   │   ├── startup.rs     起動時データ取得 / 通知 dismiss
│   │   │   └── stella.rs      StellaRecord DB 検出 / 登録 / 解除
│   │   ├── db/                Mira DB + StellaRecord DB の接続管理
│   │   │   ├── mira_db.rs     Mira DB のオープン (WAL + FK)
│   │   │   ├── stella_db.rs   StellaRecord DB の読み取り接続
│   │   │   └── migrations.rs  スキーマ DDL + 防御的マイグレーション
│   │   └── logic/             ビジネスロジック (色生成・マーカー・めもきっと)
│   └── windows/               NSIS インストーラスクリプト
├── docs/                      技術ドキュメント
└── package.json
```

レイヤ境界 (api → state → utils / services → state→DOM 等の一方向性) は ESLint の `no-restricted-imports` で機械的に強制している。

---

## Data and Privacy

本アプリはローカル完結で動作する。以下のデータをローカル保存する。

| Data                       | Location                                                       | Purpose                              |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------ |
| Mira DB                    | `%LOCALAPPDATA%\Programs\Mira\Data\db\mira.db`                 | メモ・予定・手動マーカー・ワールド色 |
| WebView2 キャッシュ        | `%LOCALAPPDATA%\Programs\Mira\Data\EBWebView\`                 | WebView2 ユーザーデータ              |
| ユーザー設定               | Windows Registry `HKCU\Software\CosmoArtsStore\Mira`           | インストール場所                     |
| StellaRecord DB (参照のみ) | `%LOCALAPPDATA%\Programs\StellaRecord\Data\db\stellarecord.db` | 訪問・同席ユーザー・写真 (read-only) |

**外部通信**: 本アプリは外部サーバとの通信を行わない。テレメトリ送信、クラッシュレポート送信、自動アップデートチェックは未実装。Google Fonts のみ初回起動時に CDN から取得する (HTML `<link>` タグ経由)。

**データの可搬性**: `Data/db/mira.db` をコピーすることでメモ・予定を別 PC へ移行可能。SQLite データベースは `sqlite3` CLI など標準ツールで直接読み出すことができる。

---

## Security

### Application

- **Tauri Capabilities**: 必要最小限の権限のみ許可。ファイルシステム操作は Rust 側で実装し、フロントエンドには直接公開していない。
- **`assetProtocol` スコープの最小化**: `src-tauri/tauri.conf.json` の `assetProtocol.scope` は `$PICTURE/VRChat/**/*.{png,jpg,jpeg}` の 3 パターンに限定。これにより WebView2 から `asset://` プロトコル経由で読み込めるローカルファイルは VRChat スクリーンショット (`%USERPROFILE%\Pictures\VRChat\` 配下の PNG/JPG/JPEG) のみとなり、ユーザーのドキュメントやデスクトップを含む他のディレクトリへのアクセスを物理的に遮断する。新たな画像ソースを追加する場合は最小一致パターンを足す方針とし、`**/*` 等のワイルドカード拡張は行わない。
- **StellaRecord DB の参照は read-only**: `Connection::open_with_flags` で `SQLITE_OPEN_READ_ONLY` を指定し、誤って書き込まないことを物理的に保証。
- **SQL Injection 対策**: 全クエリで `params!` マクロによるバインドを徹底。
- **クラッシュ抑制**: Rust リントで `unwrap_used`, `expect_used`, `panic` を `deny` に設定。コンパイル時にクラッシュ経路を排除。
- **起動失敗時の挙動**: DB 初期化 / Tauri 起動失敗時は stderr に記録のうえ正常 return することで panic を回避。

### Installation

- **管理者権限不要**: `installMode: currentUser` で `%LOCALAPPDATA%` 配下にインストール。
- **コード署名**: 現バージョンでは未実装。SmartScreen 警告が表示される可能性がある。

### Windows SmartScreen 警告について

未署名のため初回実行時に「Windows によって PC が保護されました」と表示されることがあります。

1. 警告画面で「詳細情報」をクリック
2. 表示される「実行」ボタンをクリック
3. 2 回目以降は警告は出ません

### Known Risks

- 本アプリは現在コード署名されていない。Windows SmartScreen による起動時警告が表示される。
- StellaRecord DB が取り込み処理中の場合、WAL モードにより読み取りは並行可能だが、表示されるデータが直近のセッションを含まない場合がある。
- **CSP `style-src 'unsafe-inline'` の残置**: `src-tauri/tauri.conf.json` の CSP では `style-src` に `'unsafe-inline'` を許可している。これは HomePage 等で `style.backgroundImage` などの動的 inline style を React から設定するため。将来 inline style を CSS Modules / styled-components に移行できれば `'unsafe-inline'` を撤去し、XSS 経由のスタイル注入リスクをさらに低減できる。
- **Google Fonts への CDN 依存**: Web フォントは Google Fonts CDN からロードしており、SRI hash は動的レスポンスのため設定不可。`crossorigin="anonymous"` を付与し、CSP の `font-src` / `style-src` で `fonts.googleapis.com` / `fonts.gstatic.com` のみを許可しているが、Google CDN そのものへの信頼に依存する点が残る。長期的にはフォントを `src/assets/fonts/` に同梱しオフライン化する選択肢がある。

---

## Known Limitations

- **OS タイムゾーン変更後の再起動推奨**: バックエンドは起動時に `chrono::Local` のタイムゾーン情報を取得して内部処理に使う。OS のタイムゾーンをアプリ起動中に変更した場合、変更が反映されるのはアプリの再起動後になる。リマインダー発火時刻や日付境界の判定がズレる可能性があるため、タイムゾーン変更時は Mira を一度終了してから再起動することを推奨する。

---

## Documentation

| Document                                 | Description                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| [DEVELOPMENT.md](DEVELOPMENT.md)         | 開発者向けセットアップ・運用ガイド (前提環境、DB リセット、エディタ設定) |
| [docs/spec.md](docs/spec.md)             | 機能仕様書 (アーキテクチャ、モジュール、IPC リファレンス、データフロー)  |
| [docs/database.md](docs/database.md)     | データベース定義書 (Mira DB スキーマ、StellaRecord DB の参照経路)        |
| [docs/tech-stack.md](docs/tech-stack.md) | 技術スタック詳細と意思決定記録 (ADR)                                     |

---

## Acknowledgements

### Third-Party Assets

| Asset                                | Source                                                             | License                       |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------- |
| `src/assets/textures/wood-wall.jpg`  | [ambientCG Wood026](https://ambientcg.com/view?id=Wood026)         | CC0 1.0 Public Domain         |
| `src/assets/textures/cork-board.jpg` | [ambientCG Cork001](https://ambientcg.com/view?id=Cork001)         | CC0 1.0 Public Domain         |
| `src/assets/sounds/notify-chime.mp3` | [くらげ工匠 フレーズ032](http://www.kurage-kosho.info/system.html) | Free (商用可・クレジット任意) |
| `src/assets/avatar.jpg`              | プロフィール画像 (作者所有・許諾済み)                              | All rights reserved by author |

### Web Fonts

Google Fonts より以下を CDN 経由でロード:

- [Allura](https://fonts.google.com/specimen/Allura) — SIL Open Font License 1.1
- [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) — SIL Open Font License 1.1
- [Noto Sans JP](https://fonts.google.com/noto/specimen/Noto+Sans+JP) — SIL Open Font License 1.1
- [Yomogi](https://fonts.google.com/specimen/Yomogi) — SIL Open Font License 1.1
- [Yusei Magic](https://fonts.google.com/specimen/Yusei+Magic) — SIL Open Font License 1.1
- [Kiwi Maru](https://fonts.google.com/specimen/Kiwi+Maru) — SIL Open Font License 1.1
- [Hachi Maru Pop](https://fonts.google.com/specimen/Hachi+Maru+Pop) — SIL Open Font License 1.1

### VOICEVOX (音声合成)

リマインダー読み上げ用の音声は [VOICEVOX](https://voicevox.hiroshiba.jp/) (制作: ヒホ) で事前合成したファイルを同梱している。9 キャラクター × 6 通知タイミング (5 / 10 / 15 / 20 / 30 分前 / 1 時間前) = 計 54 ファイル。

各話者の利用規約に従い、本アプリではキャラクター名を明示してクレジットする。商用利用にあたっては各話者の利用規約を必ず確認すること。

同梱音声ファイルは `src/assets/voices/<file_key>_<time_key>.wav` 形式で命名する。`file_key` と正式キャラクター名の対応は以下のとおり。`time_key` は `5min` / `10min` / `15min` / `20min` / `30min` / `1h` の 6 種類。

| `file_key` | 正式キャラクター名    | 提供元           | 利用規約                                                                       |
| ---------- | --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `metan`    | 四国めたん            | SSS合同会社      | [zunko.jp 音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)                |
| `zundamon` | ずんだもん            | SSS合同会社      | [zunko.jp 音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)                |
| `zunko`    | 東北ずん子            | SSS合同会社      | [zunko.jp 音源利用規約](https://zunko.jp/con_ongen_kiyaku.html)                |
| `tsumugi`  | 春日部つむぎ          | 春日部つむぎ公式 | [tsumugi-official rule](https://tsumugi-official.studio.site/rule)             |
| `miko`     | 櫻歌ミコ              | 櫻歌ミコ公式     | [miko35.info/voicevox](https://miko35.info/voicevox)                           |
| `whitecul` | WhiteCUL              | WhiteCUL 公式    | [whitecul.com guideline](https://www.whitecul.com/guideline)                   |
| `voidoll`  | Voidoll               | NHN PlayArt      | [compass guideline](https://app.nhn-playart.com/compass/)                      |
| `kotaro`   | 白上虎太郎 (CV: ガロ) | VirVox Project   | [virvoxproject voicevoxshiraga](https://www.virvoxproject.com/voicevoxshiraga) |
| `rito`     | 離途                  | LitMUS9          | [litmus9.com/litho](https://litmus9.com/litho)                                 |

VOICEVOX 本体の利用にあたっては [VOICEVOX 利用規約](https://voicevox.hiroshiba.jp/term) を遵守する。

### Open Source Libraries

主要な依存関係: [Tauri](https://tauri.app/), [Vite](https://vitejs.dev/), [TypeScript](https://www.typescriptlang.org/), [rusqlite](https://github.com/rusqlite/rusqlite), [chrono](https://github.com/chronotope/chrono), [winreg](https://github.com/gentoo90/winreg-rs), [serde](https://serde.rs/)

各ライセンス条項は配布物に同梱される NOTICE ファイルを参照。

---

## License

Proprietary — Copyright (c) 2025-2026 CosmoArtsStore. All rights reserved.

本ソフトウェアの再配布・改変・リバースエンジニアリングは許可されていない。
