//! Mira バックエンドのエントリポイント。
//! - DB 初期化 (Mira DB は書込可能、STELLA DB は読込専用で接続)
//! - `WebView2` のユーザーデータディレクトリを Mira の Data 配下に固定
//! - 全 Tauri コマンドを `invoke_handler` に登録して起動

mod commands;
mod db;
mod logic;

use std::path::PathBuf;

/// レジストリ HKCU\Software\CosmoArtsStore\Mira\InstallLocation を引く（インストーラが書き込む値）
fn get_install_location() -> Option<String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\CosmoArtsStore\Mira").ok()?;
    key.get_value::<String, _>("InstallLocation").ok()
}

/// Mira のデータディレクトリを 3 段階フォールバックで決定する。
/// 1. レジストリ InstallLocation\Data （正規インストール）
/// 2. 実行ファイルと同階層の Data （ポータブル/開発ビルド）
/// 3. %LOCALAPPDATA%\CosmoArtsStore\Mira\Data （最終フォールバック）
fn resolve_data_root() -> PathBuf {
    if let Some(install_dir) = get_install_location() {
        return PathBuf::from(install_dir).join("Data");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.join("Data");
        }
    }
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| r"C:\ProgramData".to_string());
    PathBuf::from(local)
        .join("CosmoArtsStore")
        .join("Mira")
        .join("Data")
}

/// Tauri アプリの起動本体。main.rs から 1 回だけ呼ばれる。
/// DB を先に初期化して `manage()` で共有し、WebView2 のキャッシュ位置を環境変数で誘導してから起動する。
/// 起動失敗は panic させず stderr に記録して正常 return することで、clippy の
/// `unwrap_used` / `expect_used` / `panic` deny ポリシーを満たす。
pub fn run() {
    let db_state = match db::initialize() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[FATAL] Mira DB の初期化に失敗しました: {e}");
            return;
        }
    };

    // WebView2 のユーザーデータ (Cookie / キャッシュ) を Mira の Data 配下に固定し、
    // インストーラ/アンインストーラで一括管理できるようにする
    let webview_data_dir = resolve_data_root().join("EBWebView");
    std::fs::create_dir_all(&webview_data_dir).ok();
    std::env::set_var(
        "WEBVIEW2_USER_DATA_FOLDER",
        webview_data_dir.to_string_lossy().to_string(),
    );

    let result = tauri::Builder::default()
        .manage(db_state)
        .invoke_handler(tauri::generate_handler![
            commands::startup::get_startup_info,
            commands::startup::get_pending_notifications,
            commands::startup::dismiss_notification,
            commands::startup::mark_review_seen,
            commands::journal::get_week_lane_data,
            commands::journal::get_day_focus_data,
            commands::journal::save_day_memo,
            commands::journal::add_manual_marker,
            commands::journal::remove_manual_marker,
            commands::calendar::get_month_data,
            commands::calendar::add_event,
            commands::calendar::remove_event,
            commands::settings::get_settings,
            commands::settings::set_setting,
            commands::settings::set_view_hour_range,
            commands::reminder::check_due_reminders,
            commands::snapshot::get_snapshot_summary,
            commands::stella::check_stellarecord_available,
            commands::stella::register_to_stellarecord,
            commands::stella::unregister_from_stellarecord,
        ])
        .run(tauri::generate_context!());

    if let Err(err) = result {
        eprintln!("[FATAL] Mira の起動に失敗しました: {err}");
    }
}
