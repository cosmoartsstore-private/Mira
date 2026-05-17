//! 横断ユーティリティ。各 commands / db / logic から共通利用される薄い helper を集約する。
//!
//! - [`logging`]: `[LEVEL][module]` 接頭辞付き eprintln ヘルパーと PII redact。

pub mod logging;
