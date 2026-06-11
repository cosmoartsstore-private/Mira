# Changelog

このプロジェクトの注目すべき変更点を記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に準拠し、
バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added

- LICENSE / NOTICE ファイルを整備し、第三者依存・アセットの権利情報を網羅。
- 技術ドキュメント 3 種 (`docs/spec.md` / `docs/database.md` / `docs/tech-stack.md`) を新設し、対象読者と相互参照を明記。
- 開発者向けセットアップ・運用ガイド `DEVELOPMENT.md` を追加 (前提環境、DB リセット手順、エディタ設定、FAQ)。

### Changed

- メモ最大長を `mira_settings.memo_max_length` 設定値で動的化 (既定 1000、最大 100000)。バックエンドで Unicode scalar 単位の安全な切り詰めを最終防衛線として実装。
- 手動マーカーの位置情報を **UTF-16 コードユニット** から **Unicode scalar 単位** に統一し、フロントエンドの選択範囲とバックエンドの保存値の解釈差を解消。
- `add_event` / `update_calendar_event` の `scheduled_at` 変更時に `reminded` フラグを巻き戻し、編集後の発火漏れを防止。
- `view_hour_start` / `view_hour_end` を `set_view_hour_range` で原子的に更新 (途中状態の `start >= end` 拒否を回避)。
- ナビゲーション・モーダル・トーストを中心に WAI-ARIA 属性とキーボード操作を強化 (a11y)。

### Fixed

- 起動失敗時の panic を排除し、stderr 記録 + 正常 return で WebView2 の白画面遷移を回避。
- VOICEVOX 音声ファイルの遅延読み込み化と、未保存メモの unmount/日付切替時 flush を追加。
- IPC コマンドハンドラから自アプリ自己登録の重複処理など dead struct / 重複定数を撤去し、emit ヘルパーを統一。

### Security

- CSP の `connect-src` / `font-src` / `style-src` を許可ドメインのみに限定。
- `tauri.conf.json` の `assetProtocol.scope` を VRChat スクリーンショット (`$PICTURE/VRChat/**/*.{png,jpg,jpeg}`) に限定し、WebView から到達可能なローカルファイル範囲を最小化。
- StellaRecord DB 連携を `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON` で二重防御化。
- Rust 側全クエリを `params!` バインドに統一し、SQL インジェクション経路を物理的に排除。
- Rust リントで `unwrap_used` / `expect_used` / `panic` を `deny` に設定し、クラッシュ経路をコンパイル時排除。

### Performance

- リマインダーポーリングに指数バックオフ (30s → 60s → 120s → 240s → 300s) と 3 連続失敗時の警告トーストを追加。
- IPC ハンドラの SQL を `visit_summary` ビュー集約等で最適化。
- Vite 本番ビルドに cssnano + postcss-colormin を導入し、配布 CSS を最小化。

## [0.1.0] - 2026-05-17 (TBD)

> 初回リリース予定。リリース日は公開時に確定する。

### Added

- 初回リリース。VRChat 活動を可視化するアクティビティジャーナル機能群を提供:
  - HomePage: 日次フォーカス、訪問・写真・メモのタイムライン表示。
  - CalendarPage: 月間ビュー、予定追加・編集・削除、週次繰り返し、過去日時警告。
  - SettingsPage: フォント、トランジション、リマインダー音・ボイスの設定。
  - StellaRecord 連携: fastparty アプリとしての自動登録、起動時ステータス表示。
  - リマインダー: バックエンドポーリングによる通知発火 (チャイム + トースト + VOICEVOX ボイス)。
  - スナップショット/年間レビュー: 四半期・年次の活動ダイジェスト表示。
