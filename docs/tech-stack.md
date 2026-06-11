# Tech Stack and Architecture Decisions

> Mira で採用した技術の詳細リファレンスと、主要な技術選定の意思決定記録 (ADR: Architecture Decision Record)。
>
> **対象読者**: 技術選定の経緯・依存バージョン・代替案の却下理由を把握したい開発者および技術評価者。
> **関連ドキュメント**: 採用技術が実際にどう組み合わさるかの仕様は [spec.md](spec.md)、データベース構造は [database.md](database.md) を参照。バージョン番号の一次情報は `package.json` および `src-tauri/Cargo.toml`。

## Table of Contents

- [Tech Stack Reference](#tech-stack-reference)
  - [Frontend](#frontend)
  - [Backend](#backend)
  - [Build and Distribution](#build-and-distribution)
  - [Quality and Tooling](#quality-and-tooling)
  - [Assets](#assets)
- [Architecture Decision Records](#architecture-decision-records)
  - [ADR-001 Application Framework: Tauri v2](#adr-001-application-framework-tauri-v2)
  - [ADR-002 UI Framework: Vanilla DOM + Custom Reactive Store](#adr-002-ui-framework-vanilla-dom--custom-reactive-store)
  - [ADR-003 Styling: CSS Custom Properties (No CSS Modules)](#adr-003-styling-css-custom-properties-no-css-modules)
  - [ADR-004 Database: SQLite via rusqlite (bundled)](#adr-004-database-sqlite-via-rusqlite-bundled)
  - [ADR-005 StellaRecord Integration: Read-Only DB Reference](#adr-005-stellarecord-integration-read-only-db-reference)
  - [ADR-006 Reminder: Frontend Polling with Exponential Backoff](#adr-006-reminder-frontend-polling-with-exponential-backoff)
  - [ADR-007 VOICEVOX: Pre-Rendered Static Audio Files](#adr-007-voicevox-pre-rendered-static-audio-files)
  - [ADR-008 Rust Lints: Deny panic-equivalent paths](#adr-008-rust-lints-deny-panic-equivalent-paths)
  - [ADR-009 Layer Boundaries: Forbid upward imports via ESLint](#adr-009-layer-boundaries-forbid-upward-imports-via-eslint)
  - [ADR-010 Installer: NSIS via Tauri Bundler](#adr-010-installer-nsis-via-tauri-bundler)
- [Rejected Technologies](#rejected-technologies)

---

## Tech Stack Reference

### Frontend

| Layer        | Technology                                    | Version | License          |
| ------------ | --------------------------------------------- | ------- | ---------------- |
| Language     | [TypeScript](https://www.typescriptlang.org/) | 5.9     | Apache-2.0       |
| UI Framework | Vanilla DOM + 自作 `Store<T>`                 | -       | -                |
| Build Tool   | [Vite](https://vitejs.dev/)                   | 7.3.1   | MIT              |
| Tauri SDK    | [@tauri-apps/api](https://tauri.app/)         | 2.11.0  | Apache-2.0 / MIT |
| Web Fonts    | Google Fonts (CDN)                            | -       | SIL OFL 1.1      |

React 等の UI ライブラリは使用しない。状態管理は `Set<Listener<T>>` ベースの最小実装 (`src/state/store.ts`)。

### Backend

| Layer                 | Technology                                                        | Version      | License          |
| --------------------- | ----------------------------------------------------------------- | ------------ | ---------------- |
| Language              | [Rust](https://www.rust-lang.org/)                                | Edition 2021 | Apache-2.0 / MIT |
| Application Framework | [tauri](https://crates.io/crates/tauri)                           | 2.11.0       | Apache-2.0 / MIT |
| Tauri Build           | [tauri-build](https://crates.io/crates/tauri-build)               | 2.6.0        | Apache-2.0 / MIT |
| Database              | [rusqlite](https://crates.io/crates/rusqlite) (`bundled` feature) | 0.38         | MIT              |
| Date/Time             | [chrono](https://crates.io/crates/chrono)                         | 0.4          | Apache-2.0 / MIT |
| Registry I/O          | [winreg](https://crates.io/crates/winreg)                         | 0.52         | MIT              |
| Serialization         | [serde](https://crates.io/crates/serde) (with `derive`)           | 1.0          | Apache-2.0 / MIT |

### Build and Distribution

| Layer            | Technology                   | Configuration                            |
| ---------------- | ---------------------------- | ---------------------------------------- |
| Bundler          | Tauri Bundler (NSIS target)  | `src-tauri/tauri.conf.json`              |
| Installer Script | NSIS                         | `src-tauri/windows/installer.nsi`        |
| Install Mode     | currentUser                  | `%LOCALAPPDATA%\Programs\Mira`           |
| Release Profile  | LTO + strip + 1 codegen-unit | `src-tauri/Cargo.toml [profile.release]` |

### Quality and Tooling

| Layer                | Technology                                                                     | Version |
| -------------------- | ------------------------------------------------------------------------------ | ------- |
| TS Linter            | [ESLint](https://eslint.org/) (flat config)                                    | 9.39    |
| TS Type-Aware Linter | [typescript-eslint](https://typescript-eslint.io/)                             | 8.48    |
| Code Quality Linter  | [eslint-plugin-unicorn](https://github.com/sindresorhus/eslint-plugin-unicorn) | 61.0    |
| CSS Linter           | [Stylelint](https://stylelint.io/) (`stylelint-config-standard`)               | 16.25   |
| Formatter            | [Prettier](https://prettier.io/)                                               | 3.6     |
| Rust Linter          | clippy                                                                         | bundled |

### Assets

| Asset Category                                                 | Source                                | License                       |
| -------------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| Wood / Cork テクスチャ                                         | ambientCG                             | CC0 1.0 Public Domain         |
| 通知音 (notify-chime.mp3)                                      | くらげ工匠 フレーズ032                | Free (商用可・クレジット任意) |
| VOICEVOX 音声 (54 ファイル、9 キャラクター × 6 通知タイミング) | VOICEVOX (制作: ヒホ、各話者の権利者) | 各話者ごとに利用規約を参照    |
| Web Fonts                                                      | Google Fonts                          | SIL OFL 1.1                   |

---

## Architecture Decision Records

各意思決定は以下のテンプレートで記述する。

```
- Status:    Accepted | Superseded | Deprecated
- Date:      決定日
- Context:   何を解決しようとしているか
- Decision:  何を採用したか
- Rationale: なぜそれを採用したか
- Alternatives Considered: 検討した他の選択肢と却下理由
- Consequences: 採用後に発生する影響（良い面・悪い面）
```

### ADR-001 Application Framework: Tauri v2

- **Status**: Accepted
- **Date**: 2025-01

**Context**

VRChat ユーザー向けの Windows デスクトップアプリケーションを開発する必要があった。要件は以下:

- リッチな UI (タイムライン、フォーカスビュー、モーダル、アニメーション)
- ローカル SQLite / レジストリへのアクセス
- 配布バイナリサイズの最小化
- メモリ・CPU 消費の抑制
- StellaRecord (Tauri v2 製) と同じエコシステムでメンテナンスする

**Decision**

Tauri v2 を採用する。フロントエンドは WebView2 上の TypeScript、バックエンドは Rust で実装する。

**Rationale**

- バイナリサイズが Electron 比 1/10 以下
- WebView2 が Windows 10 1809 以降に標準同梱されているためランタイム配布不要
- バックエンドが Rust であることで、メモリ安全性・型安全性が言語レベルで保証される
- 姉妹アプリ StellaRecord と同じスタックで保守できる

**Alternatives Considered**

| Option                 | Rejected Reason                               |
| ---------------------- | --------------------------------------------- |
| Electron               | バイナリ約 150 MB、メモリ約 200 MB            |
| WPF (.NET)             | TypeScript / Web のエコシステムを活用できない |
| ネイティブ Win32 (C++) | アニメーション・モーダルの自前実装コスト過大  |

**Consequences**

- (+) 約 12 MB のセットアップ EXE 1 つで配布完結
- (+) StellaRecord とコード規約・依存版を統一できる
- (−) WebView2 Runtime が前提 (Windows 10 1809 以降は同梱)
- (−) コード署名は別途運用が必要 (現状未実装)

---

### ADR-002 UI Framework: Vanilla DOM + Custom Reactive Store

- **Status**: Accepted
- **Date**: 2025-01

**Context**

UI 規模はナビゲーションタブ 4 つ (Home / Calendar / Settings / Debug) + モーダル数個。状態は機能ごとに独立しており、グローバル共有は最小限。「振り返り」コンセプトに合うアナログ風の手書き UI を実現するため、CSS アニメーションとレイアウトを細かく制御する必要がある。

**Decision**

React / Vue / Svelte 等の UI フレームワークは採用せず、Vanilla TypeScript + 自作 `Store<T>` クラス (`src/state/store.ts`) で構成する。DOM 構築は直接 `document.createElement` で行う。

**Rationale**

- アプリ規模が小さく、フレームワークの抽象化コストが見合わない
- アナログ風 UI の細かい DOM 制御を、フレームワークの再描画モデルと戦わずに書ける
- 依存ライブラリゼロでバンドルサイズを最小化できる
- リアクティブストアは `Set<Listener<T>>` で 50 行程度の単純実装で済む

**Alternatives Considered**

| Option | Rejected Reason                                               |
| ------ | ------------------------------------------------------------- |
| React  | 規模に対して過剰、StellaRecord 用の依存セットが Mira では不要 |
| Svelte | コンパイル時 DSL の学習コスト                                 |
| Vue    | 同上、ナビゲーション 4 タブには過剰                           |
| Lit    | カスタム要素の利点が UI 数で活きない                          |

**Consequences**

- (+) バンドルサイズ最小、依存ゼロ
- (+) DOM 操作の自由度が高い
- (−) コンポーネント再利用は手書きの関数ファクトリに頼る
- (−) アプリ規模が現状の 5 倍を超えたら再評価が必要

---

### ADR-003 Styling: CSS Custom Properties (No CSS Modules)

- **Status**: Accepted
- **Date**: 2025-01

**Context**

書体切替 (4 種) + アプリ全体 / メモのみの適用範囲切替が必要。アナログ風 UI のため CSS アニメーション・トランジションを多用する。

**Decision**

CSS Custom Properties (CSS Variables) と単純な `*.css` ファイル (`src/styles/*.css`) で構成する。CSS Modules や CSS-in-JS は採用しない。

**Rationale**

- フレームワークレスのため CSS Modules のビルド統合が要らない
- `:root` の `--memo-font` などを JS から書き換えるだけで書体・色テーマを切替えられる
- `font-scope-all` / `font-scope-content` のクラス切替で適用範囲を制御
- Vite の CSS ビルドは標準で `<style>` タグ 1 つにまとめる

**Alternatives Considered**

| Option                      | Rejected Reason                                            |
| --------------------------- | ---------------------------------------------------------- |
| CSS Modules                 | スコープ衝突がない規模のため過剰                           |
| styled-components / Emotion | CSP `unsafe-inline` 必須、フレームワークレス構成と相性悪い |
| Tailwind CSS                | アナログ風 UI の細かい数値指定と相性悪い                   |

**Consequences**

- (+) Stylelint で品質保証が容易
- (+) ランタイムオーバーヘッドゼロ
- (−) クラス名衝突は人力で管理 (現状は機能名プレフィックスで回避)

---

### ADR-004 Database: SQLite via rusqlite (bundled)

- **Status**: Accepted
- **Date**: 2025-01

**Context**

ユーザーメモ・予定・手動マーカー・色キャッシュを保管する必要がある。StellaRecord DB を参照する都合上、同じ SQLite を使うとデバッグ・運用ツールを共通化できる。

**Decision**

`rusqlite` の `bundled` feature で SQLite を静的リンクする。WAL モードと外部キー制約を有効化する。

**Rationale**

- StellaRecord と同じスタック (SQLite + rusqlite 0.38) で保守・デバッグツールを共通化できる
- `bundled` feature により OS の SQLite ライブラリに依存しない
- WAL モードで複数の IPC ハンドラからの並列読み取りが可能
- `params!` マクロで SQL インジェクションを物理的に排除

**Alternatives Considered**

| Option          | Rejected Reason                             |
| --------------- | ------------------------------------------- |
| IndexedDB       | WebView 内のみで完結、Rust から操作できない |
| sled (Rust KVS) | SQL 不可、ビュー・JOIN 不可                 |
| ファイル + JSON | スキーマ進化・並列読み取りで劣る            |

**Consequences**

- (+) 単一ファイル `mira.db` で完結、バックアップは file copy
- (+) `sqlite3` CLI や DB Browser で直接読出し可能
- (−) スキーマ移行は防御的マイグレーション (列存在チェック + ALTER) を手書き
- (−) schema_version 列を持たないため、状態追跡は列存在ベース

---

### ADR-005 StellaRecord Integration: Read-Only DB Reference

- **Status**: Accepted
- **Date**: 2025-01

**Context**

VRChat の生ログ解析は StellaRecord に完結している。Mira は StellaRecord のデータを「振り返り」のために再構成する立場であり、StellaRecord のドメインデータを重複して持つべきではない。

**Decision**

StellaRecord DB (`stellarecord.db`) を `SQLITE_OPEN_READ_ONLY` で直接開いて参照する。IPC コマンド経由ではなく、Mira プロセスが DB ファイルを直接読み取る。

**Rationale**

- StellaRecord の IPC を待つレイテンシ・StellaRecord 起動の手間を回避できる
- WAL モードで StellaRecord の書込中でも読み取り可能
- `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON` で誤書込を二重防御
- StellaRecord 未起動でも Mira が動く

**Alternatives Considered**

| Option                  | Rejected Reason                                              |
| ----------------------- | ------------------------------------------------------------ |
| StellaRecord IPC 経由   | StellaRecord に専用 IPC コマンドを生やす必要がある、結合度高 |
| Mira DB に毎日同期      | 二重保管、容量倍、同期失敗時の不整合                         |
| StellaRecord に組み込み | Mira と StellaRecord は別アプリとして配布したい              |

**Consequences**

- (+) StellaRecord の起動不要で Mira が動く
- (+) Mira の DB が小さいまま保たれる
- (−) StellaRecord の DB スキーマ変更に追従が必要 (現状は手動)
- (−) StellaRecord のレジストリ位置 (`InstallLocation`) に依存

---

### ADR-006 Reminder: Frontend Polling with Exponential Backoff

- **Status**: Accepted
- **Date**: 2025-01

**Context**

予定の N 分前にチャイム + 音声 + トーストを発火する必要がある。バックエンドの常駐タイマーは複雑で、Tauri のイベント送出周りの取り回しを増やす。

**Decision**

フロントエンドで 30 秒間隔の `setTimeout` ポーリングを実装し、バックエンドの `check_due_reminders` を呼ぶ。バックエンドは取得と同時に `reminded=1` にマークして二重発火を防ぐ。

**Rationale**

- フロント側で完結し、IPC イベントの cleanup が要らない
- 連続失敗時に指数バックオフ (30s → 60s → 120s → 240s → 300s cap) で自動復帰
- 3 回連続失敗で 1 度だけ警告トーストを表示
- 30 秒間隔は VRChat のセッション切替頻度に対して十分細かい

**Alternatives Considered**

| Option                                        | Rejected Reason                                        |
| --------------------------------------------- | ------------------------------------------------------ |
| バックエンドのタイマースレッド + イベント送出 | スレッド管理 + cleanup が複雑                          |
| Web Notifications API                         | Tauri WebView では制限あり、トースト自作の方が UX 一貫 |
| setInterval                                   | 失敗時のバックオフが setInterval と相性悪い            |

**Consequences**

- (+) フロント側で完結、デバッグが容易
- (+) 一時的な DB ロックから自動復帰
- (−) アプリ未起動時は通知が来ない (バックグラウンド常駐は未実装)
- (−) 30 秒の発火遅延が最悪ケース

---

### ADR-007 VOICEVOX: Pre-Rendered Static Audio Files

- **Status**: Accepted
- **Date**: 2025-01

**Context**

予定のリマインダーに「N 分前」を読み上げる音声を載せたい。VOICEVOX エンジンを同梱するとバイナリサイズが数百 MB 増える。

**Decision**

VOICEVOX エンジンは同梱せず、9 キャラクター × 6 通知タイミング (5/10/15/20/30 分前/1 時間前) の組み合わせ 54 ファイルを事前合成して同梱する。再生は HTML5 Audio で完結する。

**Rationale**

- バイナリサイズが約 5 MB 増にとどまる (54 ファイル × ~100KB)
- 再生レイテンシがゼロ (デコード即再生)
- VOICEVOX エンジン依存がないため、配布・起動・更新が単純
- Rust 側に HTTP クライアントが不要

**Alternatives Considered**

| Option                | Rejected Reason                              |
| --------------------- | -------------------------------------------- |
| VOICEVOX エンジン同梱 | バイナリ +数百 MB、起動時間悪化              |
| クラウド TTS API      | 外部通信が発生、ローカル完結ポリシーに反する |
| 音声を都度合成        | レイテンシ 1-3 秒、ネット接続が必要          |

**Consequences**

- (+) バイナリサイズへの影響最小
- (+) 再生が即時、ネット不要
- (+) 各話者のライセンスに従ったクレジット表記で配布可能
- (−) 通知タイミングを増やす場合は再合成 + 再配布が必要
- (−) ユーザーごとのカスタム読み上げ (タイトル名など) は不可

---

### ADR-008 Rust Lints: Deny panic-equivalent paths

- **Status**: Accepted
- **Date**: 2025-01

**Context**

ジャーナルアプリでバックエンドがクラッシュすると、ユーザーが書きかけのメモを失う可能性がある。

**Decision**

`Cargo.toml` の `[lints.clippy]` で `unwrap_used`, `expect_used`, `panic` を `deny` に設定する。

```toml
[lints.clippy]
all = { level = "warn", priority = -1 }
pedantic = { level = "warn", priority = -1 }
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "warn"
dbg_macro = "warn"
print_stdout = "warn"
too_many_lines = "warn"
module_name_repetitions = "allow"
must_use_candidate = "allow"
needless_pass_by_value = "allow"
too_many_arguments = "allow"
```

**Rationale**

- StellaRecord と同じ品質ポリシーで保守
- コンパイル時に `Result` の伝播を強制
- 起動失敗時は `eprintln!` + 正常 return で panic させない

**Alternatives Considered**

| Option                    | Rejected Reason       |
| ------------------------- | --------------------- |
| デフォルトのみ            | unwrap が混入しやすい |
| `clippy::all = warn` のみ | 警告は無視されがち    |

**Consequences**

- (+) Rust コード全体で `unwrap()` ゼロ、`expect()` ゼロ
- (+) エラーは全て `Result` で UI まで伝播し、トースト通知される
- (−) プロトタイピング時は一時的に lint を緩める運用が必要

---

### ADR-009 Layer Boundaries: Forbid upward imports via ESLint

- **Status**: Accepted
- **Date**: 2025-01

**Context**

React 製の StellaRecord は feature モジュール間の相互参照を ESLint で禁止しているが、Mira はフレームワークレス + 機能別ページ構成のため別の境界設計が必要。

**Decision**

ESLint の `no-restricted-imports` でレイヤ間の上位参照を禁止する。

- `utils/**` → 全レイヤ参照禁止 (リーフ層)
- `state/**` → pages / components / services / animations 参照禁止
- `api/**` → 上位レイヤ + state/store 参照禁止 (一方向)
- `services/**` → pages / components 参照禁止
- `animations/**` → pages / components / services / api 参照禁止
- `components/**` → pages / services 参照禁止
- `pages/**` → 他の pages 参照禁止

**Rationale**

- レイヤ階層を機械的に強制する
- 「ちょっと別ページの関数を使いたい」誘惑を防止
- `state/types` は payload 型定義として参照可、`state/store` のみ runtime 禁止

**Alternatives Considered**

| Option                 | Rejected Reason |
| ---------------------- | --------------- |
| 規約のみ               | 守られない      |
| 単一ディレクトリ平坦化 | スケールしない  |

**Consequences**

- (+) レイヤ境界が機械的に保証される
- (+) リファクタリング時の影響範囲が明確
- (−) 共有が必要になった場合は `utils/` への切り出し判断が発生

---

### ADR-010 Installer: NSIS via Tauri Bundler

- **Status**: Accepted
- **Date**: 2025-01

**Context**

Windows 向けの配布形式が必要。StellaRecord と同じ流儀で配布したい。

**Decision**

Tauri Bundler の NSIS ターゲットを採用し、`installer.nsi` をカスタムテンプレートとして使用する。

**Rationale**

- Tauri Bundler 公式サポート (`tauri.conf.json` で指定するだけ)
- `installMode: "currentUser"` で管理者権限不要
- StellaRecord と配布形式を統一できる

**Alternatives Considered**

| Option       | Rejected Reason                                                |
| ------------ | -------------------------------------------------------------- |
| MSI (WiX)    | Tauri 標準サポートなし                                         |
| Portable EXE | レジストリ書込・StellaRecord 連携用 InstallLocation が取れない |

**Consequences**

- (+) 約 12 MB のセットアップ EXE 1 つで配布完結
- (+) StellaRecord と同じ流儀
- (−) 自動更新は別途必要 (現状未実装)

---

## Rejected Technologies

主要な検討の中で意図的に採用しなかった技術と却下理由の一覧。

| Technology                             | Reason for Rejection                                  |
| -------------------------------------- | ----------------------------------------------------- |
| Electron                               | バイナリ・メモリともに 10 倍規模                      |
| React / Vue / Svelte                   | アプリ規模に対して過剰、アナログ風 DOM 制御と相性悪い |
| Redux / Zustand / Jotai                | 自作 `Store<T>` で十分                                |
| Tailwind CSS                           | 細かい数値指定の手書き UI と相性悪い                  |
| CSS-in-JS (styled-components, Emotion) | CSP `unsafe-inline` 必須                              |
| TanStack Query                         | サーバ通信ゼロ、ローカル DB のみ                      |
| ORM (Diesel / SeaORM)                  | スキーマが小規模で生 SQL が読みやすい                 |
| VOICEVOX エンジン同梱                  | バイナリサイズ +数百 MB                               |
| Tauri Updater                          | 現バージョンではスコープ外                            |
| Sentry / Telemetry                     | ローカル完結ポリシーに反する                          |
| i18next                                | 日本語固定、要件発生時に導入                          |

---

## 関連ドキュメント

- [spec.md](spec.md) — 採用技術が実際にどう組み合わさるかの機能仕様
- [database.md](database.md) — SQLite スキーマ定義 (ADR-004 の具体形)
- [../README.md](../README.md) — ユーザー向け概要・依存ランタイム
- [../DEVELOPMENT.md](../DEVELOPMENT.md) — 開発環境セットアップと lint/format コマンド
