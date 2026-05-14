//! Tauri コマンド (#[tauri::command]) の集約モジュール。
//! 命名規則: ファイル名 = フロント側の機能領域 (journal / calendar / settings / reminder / startup / stella)。
//! 各ファイルの pub fn が lib.rs::run の invoke_handler! マクロに列挙される。

pub mod calendar;
pub mod journal;
pub mod reminder;
pub mod settings;
pub mod snapshot;
pub mod startup;
pub mod stella;