//! Tauri コマンド (#[`tauri::command`]) の集約モジュール。
//! 命名規則: ファイル名 = フロント側の機能領域 (journal / calendar / settings / reminder / startup / stella)。
//! 各ファイルの pub fn が `lib.rs::run` の `invoke_handler`! マクロに列挙される。

pub mod calendar;
pub mod journal;
pub mod reminder;
pub mod settings;
pub mod snapshot;
pub mod startup;
pub mod stella;

/// `remind_minutes_before` 等で許容する上限値 (24 時間 = 1440 分)。
/// `calendar::add_event` と `settings::set_setting` の両方で参照されるため、
/// 重複定義を避けるためにここに集約する。
pub const REMIND_MIN_MAX: i64 = 1440;

/// メモ最大文字数のデフォルト (`mira_settings.memo_max_length` 未設定時のフォールバック)。
/// L2 R2-18: `journal::save_day_memo` と `settings::get_settings` の両方が
/// `unwrap_or(1000)` していたのを集約参照する。
pub const DEFAULT_MEMO_MAX_LENGTH: i64 = 1000;
