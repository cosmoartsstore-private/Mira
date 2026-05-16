//! Mira アプリのエントリポイント。リリースビルドでは `windows_subsystem = "windows"` を
//! 指定してコンソールウィンドウを抑制し、`mira_lib::run` に処理を委譲する。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mira_lib::run();
}
