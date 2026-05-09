mod commands;
mod db;
mod logic;

use std::path::PathBuf;

fn get_install_location() -> Option<String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\CosmoArtsStore\Mira").ok()?;
    key.get_value::<String, _>("InstallLocation").ok()
}

fn resolve_data_root() -> PathBuf {
    if let Some(install_dir) = get_install_location() {
        return PathBuf::from(install_dir).join("Data");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.join("Data");
        }
    }
    let local = std::env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| r"C:\ProgramData".to_string());
    PathBuf::from(local)
        .join("CosmoArtsStore")
        .join("Mira")
        .join("Data")
}

/// Tauriアプリケーションを初期化して起動する
pub fn run() {
    let db_state = db::initialize().expect("Failed to initialize databases");

    let webview_data_dir = resolve_data_root().join("EBWebView");
    std::fs::create_dir_all(&webview_data_dir).ok();
    std::env::set_var(
        "WEBVIEW2_USER_DATA_FOLDER",
        webview_data_dir.to_string_lossy().to_string(),
    );

    tauri::Builder::default()
        .manage(db_state)
        .invoke_handler(tauri::generate_handler![
            commands::startup::get_startup_info,
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
            commands::settings::get_favorite_users,
            commands::settings::add_favorite_user,
            commands::settings::remove_favorite_user,
            commands::reminder::check_due_reminders,
            commands::stella::check_stellarecord_available,
            commands::stella::register_to_stellarecord,
            commands::stella::unregister_from_stellarecord,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
