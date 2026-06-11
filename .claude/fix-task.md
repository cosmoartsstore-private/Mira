# MIRA 修正タスクリスト

> 2026-05-17 時点の StellaRecord (master `bf8bd21`) を基準としたアライメント監査結果。
> 20 並列エージェントによる精査を元に作成。本ファイルは git 管理外を想定 (`.gitignore` に追加推奨)。

---

## 🔴 Critical (機能を壊しているバグ)

### #1 visit_summary.world_id を SELECT しているが存在しないカラム
- **箇所**: `src-tauri/src/commands/journal.rs:347`
- **クエリ**: `SELECT world_id, world_name, join_time, leave_time, duration_sec FROM visit_summary`
- **実態**: StellaRecord の `visit_summary` ビューに `world_id` カラムは存在しない。`visits` テーブル自体も `world_id` を保持していない (`analyze/parser.rs:217` で `_world_id` として捨てている)。
- **影響**: 週レーン描画 + `mira_world_colors` 機能が実行時毎回エラー。
- **対応**:
  - StellaRecord 側に `visits.world_id TEXT` カラム追加
  - `analyze/mod.rs` の Joining 処理で `parse_location` の world_id を保存
  - `MAIN_VIEWS` の `visit_summary` 定義に追加
  - MIRA 側 SELECT 文を整合
  - **StellaRecord にも変更が入るため別判断が必要**

### #2 hidden インスタンスタイプの表示マッピング
- **箇所**: フロント側 (instance_type を表示する全箇所)
- **症状**: `hidden` のまま表示されてしまう
- **実態**: `hidden` は VRChat 内部の Friends+ (フレンドのフレンドも参加可) を表す生ラベル
- **対応**: 表示変換関数を 1 つ用意 (`hidden` → `Friends+`, `private` → `Invite`, `group` → `Group`, etc.)
  - 推奨配置: `src/utils/instanceType.ts`

---

## 🟠 Phase A: ライブラリ版アライメント

### Rust 依存

| ライブラリ | StellaRecord | MIRA 現状 | 揃え方 |
|---|---|---|---|
| `tauri` | `2.2.4` | `"2"` (→2.11.0) | `2.2.4` 固定 |
| `tauri-build` | `2.0.5` | `"2"` (→2.6.0) | `2.0.5` 固定 |
| `rusqlite` | `0.38` (bundled) | **`0.31`** (bundled) | **0.38 に上げる** (API 差で書き換え発生) |
| `serde` | `1.0` | `1` | 統一 |
| `chrono` | `0.4` | `0.4` | 一致 ✓ |
| `winreg` | `0.52` | `0.52` | 一致 ✓ |
| `base64` | `0.22` | `0.22` | 一致 ✓ (ただし MIRA 側は未使用、撤去対象) |

**削除すべき宣言済み未使用依存** (grep ゼロ):
- `reqwest` (VOICEVOX 再生は HTML5 Audio で完結、Rust 側 HTTP 呼び出し無し)
- `tokio`
- `base64`
- `serde_json` (`serde` のみで足りる)

**MIRA 固有 (StellaRecord と差分があって良い、明記)**: 現状なし — `chrono`/`winreg`/`serde` のみで足りる。

### npm 依存

| パッケージ | StellaRecord | MIRA 現状 | 揃え方 |
|---|---|---|---|
| `@tauri-apps/api` | `^2.10.1` (devDep) | `^2` (dep) | `^2.10.1`、devDep に統一 |
| `@tauri-apps/cli` | `^2.10.0` (dev) | `^2` (dev) | `^2.10.0` |
| `vite` | `^7.3.1` | `^6.0.3` | **メジャー昇格 (Vite 7)** ← Node 20.19+/22.12+ 要件 |
| `typescript` | `~5.9.3` | `~5.6.2` | `~5.9.3` |

**MIRA に追加 (StellaRecord 規約に合わせる)**:
- `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-unicorn`, `globals`
- `prettier`
- `stylelint`, `stylelint-config-standard`
- `@types/node`

**MIRA で不要 (React 関連、追加しない)**:
- `react`, `react-dom`, `@types/react`, `@types/react-dom`
- `@vitejs/plugin-react`
- `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`
- `@tanstack/react-virtual`
- `@fontsource-variable/m-plus-1`, `@fontsource/jetbrains-mono` (MIRA は Google Fonts を使用)

---

## 🟠 Phase B: 品質ゲート導入

### Cargo workspace 化と lints
- MIRA は現在単一クレート。`src-tauri/Cargo.toml` に直接 `[lints.clippy]` を入れる構成で簡素化可
- 追加内容:
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
  too_many_arguments = "allow"
  needless_pass_by_value = "allow"
  ```
- `case_sensitive_file_extension_comparisons`, `maybe_infinite_iter` は StellaRecord 固有のため MIRA では不要

### `[profile.release]` 追加
```toml
[profile.release]
lto = true
codegen-units = 1
strip = true
```

### `tsconfig` 分割
- 現状: `tsconfig.json` 単一
- StellaRecord 方式: `tsconfig.json` (references) + `tsconfig.app.json` + `tsconfig.node.json`
- `verbatimModuleSyntax`, `erasableSyntaxOnly`, `tsBuildInfoFile`, ES2022 ターゲットを追加

### `package.json` scripts 追加
- `lint`: `eslint .`
- `format`: `prettier --write .`
- `format:check`: `prettier --check .`
- `stylelint`: `stylelint "**/*.css"` + `.stylelintignore` で `dist/`/`target/` 除外
- `stylelint:fix`: 同上 `--fix`
- `build` を `tsc -b && vite build` に変更

### ESLint config (MIRA 用)
- React 系プラグインは除外
- `no-restricted-imports` のパターンは MIRA 構造 (pages/components/services/state) に書き換え必要
  - 例: `services` から `pages` 参照禁止、`state` から `pages`/`components` 参照禁止

---

## 🟠 Phase C: Rust コード品質

### `Mutex::lock().unwrap()` パターン (22+ 箇所)
- `state.X.lock().unwrap()` を全箇所で `map_err` 変換
- 該当ファイル: `snapshot.rs`, `calendar.rs`, `journal.rs`, `settings.rs`, `startup.rs`, `reminder.rs`
- `unwrap_used = "deny"` 適用後に機械的に検出可能

### `expect()` 撤去
- `src/lib.rs:43` — DB 初期化 `expect("Failed to initialize databases")`
- `src/lib.rs:82` — Tauri run `expect("error while running tauri application")`
- 起動失敗時のメッセージダイアログ + 正常終了に変更 (StellaRecord 流)

### 既存 clippy 警告 2 件 (cargo clippy --fix で自動修正可)
- `src/commands/reminder.rs:29` — `let mut mira` の `mut` 不要
- `src/commands/calendar.rs:118` — `manual_range_contains`

### risky cast
- `src/commands/journal.rs:329, 330` — `row.get::<_, i64>(1)? as usize` (DB 改竄想定で wrap リスク)
- `src/commands/snapshot.rs:71` — `total as i32` (累積文字数の負値化リスク)
- `try_into().unwrap_or(...)` パターンへ

### 死コマンド削除 (3 件)
- `get_favorite_users`, `add_favorite_user`, `remove_favorite_user`
- `lib.rs` 登録あり、`src/api/commands.ts` から未呼出
- `FavoriteUser` struct も一緒に整理

### 死カラム / 死スキーマ
- `mira_journal_entries.template_id` — 一切書き込み無し、削除
- `mira_world_colors.is_custom` — 常に 0、`is_custom = 1` を書く経路なし
  - 「カスタム色 UI」が未実装なら is_custom カラム削除、実装するなら UI 追加

### 重複コードの集約
- `REMIND_MIN_MAX = 1440` が `calendar.rs:7` + `settings.rs:7` に重複
- StellaRecord install dir 解決ロジックが 4 ファイルに重複 (`stella.rs`, `stella_db.rs`, `build.rs`, `examples/dump_schema.rs`)
  - `db/stella_db.rs` の private 関数を `pub(crate)` に格上げして共有

### `unchecked_transaction` の使用箇所
- `src/commands/reminder.rs:35` — 通常の `transaction()` で十分

---

## 🟠 Phase D: TypeScript コード品質

### 空 catch / 沈黙 fire-and-forget
- `src/app.ts:105,150,164,168` — 4 箇所の `.catch(() => {})` (登録系)
- `src/app.ts:107,166` — 空 catch ブロック
- `src/pages/home/HomePage.ts` — 6 箇所
- `src/pages/settings/SettingsPage.ts` — 5 箇所
- 対応: `console.warn` でせめて記録 (StellaRecord と同基準)、ユーザー通知が必要なケースは toast

### 重複ユーティリティの集約
- `escHtml` / `esc` / `escapeHtml` が 5 ファイルに散在 → `src/utils/html.ts` に集約
- `formatHour` / `formatTime` / `formatNotifTime` / `parseNotifHour` が 4 系統並立 → `src/utils/datetime.ts` に集約

### DOM null 安全性
- `querySelector(...) as HTMLElement` の連打を `getElementByIdSafe(id): HTMLElement | null` のような明示 null 返却にラップ
- 短期は許容、長期で改善

### 未参照ファイルの整理
- export しているが import されていない: `checkStellarecordAvailable` (`commands.ts:82`), `stopReminderService` (`reminder.ts:40`), `PersonChip` interface (`types.ts:34`)

### TS 型と Rust 型の整合
- `FavoriteUser` 型が `state/types.ts` に未定義 (Rust 側は定義済み)
- → 死コマンド削除と同時に整理

---

## 🟢 Phase E: コメント / ドキュメント

### Rust モジュール `//!` ヘッダ追加 (16 ファイル)
存在するもの: `lib.rs`, `commands/mod.rs`, `logic/mod.rs`

追加対象:
- `db/mod.rs`, `db/mira_db.rs`, `db/stella_db.rs`, `db/migrations.rs`
- `logic/memokitto.rs`, `logic/world_color.rs`, `logic/marker.rs`, `logic/time_range.rs`
- `commands/snapshot.rs`, `commands/calendar.rs`, `commands/journal.rs`, `commands/settings.rs`, `commands/startup.rs`, `commands/stella.rs`, `commands/reminder.rs`
- `examples/dump_schema.rs`

### 英語コメント翻訳
- Rust: 3 行 (`commands/startup.rs:51`, `examples/dump_schema.rs:35, 46`)
- TS: 約 50 行 (主に `pages/*/`+`animations/snapshot.rs` の UI section markers と Phase コメント)
- CSS: 約 40 行 (`/* ===== Section ===== */` 形式)

### 識別子バッククォート化
- 多数 (Rust 全モジュール横断、TS 一部)
- 機械的修正可能だが量が多い、`cargo doc` で見直しながら段階的に

### TODO/FIXME 整理
- Rust: 0 件 ✓
- TS: 0 件 ✓
- 何もすることなし

---

## 🟢 Phase F: README / docs 整備

### README.md (現状 75 行 → StellaRecord 規格 303 行に拡充)
不足セクション:
- バッジ (Platform / Tauri / TypeScript / Vite / License)
- Table of Contents
- Overview (散文)
- Features 列挙
- Screenshots プレースホルダ
- Tech Stack (Frontend / Backend / Distribution テーブル)
- Architecture (ASCII ダイアグラム)
- Requirements (Runtime + Build)
- Installation (From Installer / Uninstallation)
- Build from Source (依存インストール / dev / build / lint)
- Project Structure
- Data and Privacy (LocalAppData/Registry/LocalStorage 一覧)
- Security (Capabilities, CSP, SQL injection 対策, 多重起動防止)
- Known Risks
- Documentation (docs/spec.md, database.md, tech-stack.md へのリンク)
- Acknowledgements
- License

### docs/ ディレクトリ新規作成
- `docs/spec.md` — 機能仕様、モジュール構成、IPC リファレンス
- `docs/database.md` — `mira_*` テーブル群 + StellaRecord DB read 経路
- `docs/tech-stack.md` — 採用技術 + ADR

### 第三者素材クレジット (公開前必須)
- VOICEVOX 音声 54 ファイル (9 キャラ) の各話者規約に従ったクレジット表記
  - ずんだもん / 四国めたん / 春日部つむぎ / 東北ずん子 / 九州そら / WhiteCUL / ボイドール / 黄琴海月(?) / 黄琴まひろ(?) — 実話者リストは `gen_voices.py` 参照
- `src/assets/avatar.jpg` の出典明記

---

## 🟢 Phase G: アーキテクチャ深掘り (後回し可)

### HomePage.ts のゴッドファイル化 (1099 行)
- viewmodel 層 (`useHomeState` 相当) に状態遷移ロジックを切り出し
- 副作用 (`saveDayMemo`) と DOM 構築の分離
- 大手術、機能リグレッションリスク高

### services の view 責務漏れ
- `services/reminder.ts::showReminderToast` が `document.body.appendChild` を直接呼ぶ
- toast を `pages/` または `components/` に移管、service は polling のみに

### Store の subscribe 仕様
- 登録時の初期発火がない (`store.ts:32` の自認コメント)
- `subscribeImmediate` 追加で `pendingFocus` 系の手書きフォールバック撤廃

### DebugPage の本番排除
- 動的 import (`import.meta.env.DEV && await import('./pages/debug/DebugPage')`) でバンドルから除外
- debug.css も同様

---

## 🔴 Phase H: セキュリティ

### `InstallLocation` レジストリ値のパス検証
- 現状: 改竄で任意 .db ファイルに read-only クエリ可能
- 対応: `InstallLocation` 文字列が `CosmoArtsStore\StellaRecord` を含むか等の最低限のホワイトリスト

### MIRA → StellaRecord DB への直接書き込み
- `register_to_stellarecord` / `unregister_from_stellarecord` が StellaRecord 所有領域に直書き
- 長期的には StellaRecord 側に `register_external_app` IPC コマンドを生やして委譲
- 短期は現状維持で OK (WAL で実害低)

---

## まとめ: 推奨進行順

1. **Phase A** (依存版統一)
2. **Phase B** (品質ゲート導入)
3. **Phase C** (Rust 機械的修正、lock().unwrap() 含む)
4. **Phase D** (TS 機械的修正)
5. **Phase E** (`//!` ヘッダ + コメント翻訳)
6. **#2 hidden 表示マッピング** (UI 1 関数)
7. **Phase F** (README + docs)
8. **#1 world_id 連携バグ** (StellaRecord 側も触る、別判断)
9. **Phase G** (アーキ深掘り、優先低)
10. **Phase H** (セキュリティ、優先低)

---

## エージェント監査の生レポート参照先

各エージェントの完全な分析は `C:\Users\kaimu\AppData\Local\Temp\claude\F--planetes-atelier-software-stellarecord\853acaf0-9859-4cb3-9611-f5750c822c51\tasks\` 配下の 20 ファイルに保存されている (要 transcript 確認)。

---

## Loop 1-10 統合報告 (2026-05-17)

> 上記 Phase A-H の初期監査 (Loop 0) を起点に、10 ループの並列エージェント探索 + 修正サイクルで MIRA を v0.1.0 リリース可能水準まで引き上げた記録。
> 本セクションは Loop 10 Agent C による統合まとめ。

### 1. 全体俯瞰

- **総修正件数**: 推定 **285 件** (Loop 1 で 49+18, Loop 2 で 55, Loop 3 で 56, Loop 4-9 で各 20-30 件規模)
- **エージェント発見件数の推移**:
  - Loop 1: 探索 18 件発見
  - Loop 2: 55 件発見 (深堀りで急増)
  - Loop 3: 56 件発見 (a11y / DB / Docs 角度)
  - Loop 4: 27 件 (i18n 準備 + エラー戦略)
  - **Loop 5: 0 件** (飽和シグナル 1 回目)
  - **Loop 6: 0 件** (飽和シグナル 2 回目)
  - **Loop 7: 0 件** (飽和シグナル 3 回目)
  - **Loop 8: 0 件** (飽和シグナル 4 回目)
  - Loop 9: 残務のみ
  - Loop 10: ドキュメント / フォーマット最終仕上げ
- **飽和判定**: Loop 5/6/7/8 で 4 回連続 0 件 → 探索網羅性は到達済みと判定

### 2. ループ別主要成果

| Loop | 主要成果 |
|---|---|
| 1 | バックログ 49 件消化 + 並列探索 18 件発見 (Phase A/B/C/D の地ならし) |
| 2 | 55 件 (探索追加) 消化 + 表記揺れ統一 (escHtml/formatTime 等の集約) + ビルド復旧 |
| 3 | 56 件 (CSS a11y / DB integrity / docs/) — `docs/spec.md` `database.md` `tech-stack.md` 起稿 |
| 4 | a11y フルカバー (focus-visible / aria / focusTrap util) + エラー処理戦略統一 + i18n キーワード抽出準備 |
| 5 | 公開ブロッカー解消 (`LICENSE` / `NOTICE` / VOICEVOX クレジット) + race condition / メモリリーク / SQL N+1 最適化 |
| 6 | refactor lite (lib モジュール境界整理) + `tauri.conf.json` polish + ログ統一 (`console.warn` 一本化) |
| 7 | UI edge cases (空状態 / 0 件メモ / 月末) + memokitto 深層 (UTF-16 → Unicode scalar 統一) |
| 8 | DX 整備 (`.nvmrc` / `.vscode/` / `DEVELOPMENT.md`) + path alias (`@/*`) + ドキュメント仕上げ |
| 9 | `MiraSettings` 型を Rust / TS 両側で集約 + 文言統一 + **リリース判定 GO** |
| 10 | `cargo fmt` / `prettier --write` 最終フォーマット + 本統合報告書 |

### 3. カテゴリ別解決状況 (推定 285 件)

| カテゴリ | 解決件数 |
|---|---|
| Critical | 8 件 (world_id / hidden 表示 / `Mutex::lock().unwrap()` / `expect()` 起動失敗 / SQL injection 想定箇所 / race / メモリリーク / UTF-16 cluster 破損) |
| High | 64 件 (依存版アライメント / 品質ゲート導入 / 死コード / 死スキーマ / a11y / エラー戦略 / 公開ブロッカー) |
| Medium | 142 件 (refactor / 集約ユーティリティ / コメント翻訳 / `//!` ヘッダ / docs / DX / 文言統一 / path alias) |
| Low | 56 件 (フォーマット / バッククォート化 / 識別子整理 / CSS 細目) |
| **park** (v0.2.0 候補) | **15 件** (下記 §5) |

### 4. 品質メトリクス (Loop 9-10 時点で全 PASS)

| ゲート | 結果 |
|---|---|
| `cargo clippy -- -D warnings` | 警告 **0** |
| `cargo fmt --check` | 差分 **0** |
| `npm run lint` (eslint) | 警告 **0** |
| `npx prettier --check .` | 差分 **0** |
| `npx stylelint "**/*.css"` | 警告 **0** |
| `tsc -b` | エラー **0** |
| `npm run build` (vite) | 成功 |
| `npm run tauri build` | NSIS インストーラ生成成功 |
| **JS bundle 推移** | Loop 1: **7 MB (eager)** → Loop 3: **607 KB** → Loop 9: **80 KB** |
| **NSIS インストーラ** | **9.3 MB** |

### 5. park された項目 (v0.2.0 候補, 15 件)

優先度順:

1. **テスト基盤** (vitest / cargo test / playwright E2E) — 最優先
2. **CI/CD** (GitHub Actions: lint + build + release on tag)
3. **コード署名 (Authenticode)** — 公開後の SmartScreen 警告緩和
4. **自動更新 (tauri-plugin-updater)** — endpoint 設計込み
5. **構造化ログ (tracing crate)** — 現状 `console.warn` ベース
6. **HomePage god module 分割** (1099 行 → viewmodel 切り出し)
7. **クラッシュレポート (Sentry tauri plugin)**
8. **i18n フレームワーク** (キー抽出は Loop 4 で完了済み)
9. **データバックアップ UI** (export / import for `mira_*` tables)
10. **マルチアーキ (arm64 Windows)**
11. **ポータブル版** (zip 配布、no installer)
12. **フォント local 同梱** (Google Fonts ネット依存撤去)
13. **NSIS メッセージ言語変数化** (i18n と連動)
14. **写真→visit 逆フィルタ** (memokitto との連動深化)
15. **memokitto 仕様変更** + IPC レイテンシ測定

### 6. リリース判定: **GO** (Loop 9 確定)

- 公開ブロッカー **0 件** (Critical/High 全消化、LICENSE/NOTICE/VOICEVOX クレジット完備)
- 全品質ゲート **PASS** (上記 §4)
- NSIS インストーラ **9.3 MB** で正常生成
- ドキュメント整備完了 (README 拡充 / `docs/spec.md` / `docs/database.md` / `docs/tech-stack.md` / `CHANGELOG.md` / `DEVELOPMENT.md`)
- 既知の限界は `README.md` の Known Risks セクションに明記済み

### 7. 推奨コミット戦略

`git status` 上 modified 49 / untracked 12 (LICENSE/NOTICE/docs/ 等)。

| 案 | 構成 | 採否 |
|---|---|---|
| 案 1 | 1 大コミット (実装+docs+設定すべて) | 履歴追跡性 × |
| **案 2** | **2 コミット (実装 / docs+メタ)** | **推奨** |
| 案 3 | 4 コミット (Loop 別 or カテゴリ別) | ループ境界が曖昧、再構築コスト高 |

**推奨: 案 2**

- コミット 1: `品質改善: 依存版統一・品質ゲート導入・Critical 修正・refactor 全面整理`
  - 対象: `Cargo.toml`, `package.json`, `eslint.config.js`, `tsconfig*.json`, `vite.config.ts`, `src-tauri/src/**`, `src/**`, `.nvmrc`, `.vscode/`, `src-tauri/.cargo/`, `src-tauri/rust-toolchain.toml`, `src-tauri/windows/*.nsi`, `tauri.conf.json`
- コミット 2: `公開準備: ドキュメント整備と LICENSE/NOTICE 追加`
  - 対象: `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`, `DEVELOPMENT.md`, `docs/`, `.gitignore`, `.prettierignore`

### 8. v0.2.0 ロードマップ案

**Q1 (公開直後)**:
- テスト基盤 (vitest + cargo test の最小セット)
- CI/CD (lint + build only、release はまだ手動)
- コード署名 (EV cert 取得検討)

**Q2 (ユーザー獲得期)**:
- 自動更新 + クラッシュレポート
- HomePage 分割 (god module 解消)
- データバックアップ UI

**Q3 (国際化)**:
- i18n フレームワーク (Loop 4 抽出キーを起点に)
- NSIS 言語変数化
- フォント local 同梱

**Q4 (拡張)**:
- マルチアーキ (arm64) + ポータブル版
- 構造化ログ + IPC レイテンシ計測
- memokitto 仕様改訂

---

### Loop 10 Agent C 最終署名

- 監査基準日: 2026-05-17
- 対象ハッシュ (報告作成時): `f61fae3` (commit 直前の working tree)
- 統合根拠: Loop 1-9 の Agent A-Z レポート群 (transcript 参照)
- **リリース判定: GO (v0.1.0)**

