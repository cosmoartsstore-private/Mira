//! バックエンドの純粋ロジック層 (DB I/O や Tauri State に依存しないモジュール群)。
//! `commands` から呼び出されてレーン色生成・マーカー検出・時間帯推定などを担う。

pub mod marker;
pub mod memokitto;
pub mod time_range;
pub mod world_color;
