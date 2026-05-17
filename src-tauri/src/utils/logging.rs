//! 軽量ログ ユーティリティ。
//!
//! Mira では `log` クレートや `tracing` のような全機能型ロガーは導入せず、
//! `eprintln!` ベースの最小限ヘルパーで [LEVEL][module] prefix を統一する。
//! - `release` ビルドでは `windows_subsystem = "windows"` でターミナルが無いため、
//!   stderr は親プロセス経由 (Tauri/CLI からの起動) でしか拾えない。
//!   それでも prefix を揃えておくことで、サポート問い合わせ時のログ抜粋が読みやすくなる。
//! - PII (ワールド名 / メモ内容 / 予定タイトル等) は [`redact`] で長さ表示のみに変換し、
//!   ログ収集経路に生値を流さない方針。
//!
//! 既存の `eprintln!("[module] ...")` を順次これらに置換していく。
//! `log_*` ヘルパーは行末 `\n` を `eprintln!` 経由で付与するため、呼出側は付けないこと。

/// 情報レベル: 起動完了 / マイグレーション開始終了 など状態遷移の節目。
pub fn log_info(module: &str, msg: &str) {
    eprintln!("[INFO][{module}] {msg}");
}

/// 警告レベル: フォールバック発生 / 軽微な不整合検知 など。
/// 機能継続はするが運用者の注意を促したい事象に使う。
#[allow(dead_code)] // 将来 fallback 検知パスから呼ばれる想定 (現状の eprintln 置換で使用)
pub fn log_warn(module: &str, msg: &str) {
    eprintln!("[WARN][{module}] {msg}");
}

/// エラーレベル: SQL / parse / IO の失敗。ユーザー向けメッセージは別途返した上で
/// 詳細はこちらに残す。生の例外文字列は SQL/IO 由来でも比較的安全だが、
/// ユーザー入力値 (PII 候補) は [`redact`] で包んでから渡すこと。
pub fn log_error(module: &str, msg: &str) {
    eprintln!("[ERROR][{module}] {msg}");
}

/// PII レダクション。生値をログに残さず、文字数だけを開示する。
///
/// 例: `redact("ワールド名")` -> `"<redacted:5>"` (chars 数。bytes ではない)。
/// 文字数はマルチバイトを 1 としてカウントするため、運用者は概ねの長さ感覚を得られる。
pub fn redact(s: &str) -> String {
    format!("<redacted:{}>", s.chars().count())
}
