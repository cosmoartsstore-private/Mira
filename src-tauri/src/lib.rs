//! Mira バックエンドのエントリポイント。
//! - DB 初期化 (Mira DB は書込可能、STELLA DB は読込専用で接続)
//! - `WebView2` のユーザーデータディレクトリを Mira の Data 配下に固定
//! - 全 Tauri コマンドを `invoke_handler` に登録して起動

mod commands;
mod db;
mod logic;
mod utils;

use std::path::PathBuf;

use utils::logging;

/// レジストリ HKCU\Software\CosmoArtsStore\Mira\InstallLocation を引く（インストーラが書き込む値）
fn get_install_location() -> Option<String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\CosmoArtsStore\Mira").ok()?;
    key.get_value::<String, _>("InstallLocation").ok()
}

/// CLI 引数として渡されたパス文字列を安全な絶対パスへ変換する。
///
/// 現状は呼び出し元なし。将来 CLI で `mira.exe <path>` のようにファイルパスを受け取って
/// 起動する拡張を行う場合、`single-instance` の args ハンドラ等から本関数を呼び出して
/// 検証を通すこと。検証内容:
///   1. `std::fs::canonicalize` で `\\?\` 正規化済みの絶対パスへ解決
///      (シンボリックリンク / `..` の打ち消しを含む)。
///   2. 許可ベースディレクトリ (`%USERPROFILE%\Pictures\VRChat`) の prefix と一致するか
///      確認し、外側の参照 (パストラバーサル) を拒否。
///
/// 戻り値が `None` の場合は「無効な引数」として呼び出し元で破棄する。
#[allow(dead_code)] // 将来 CLI 拡張時に call。現状未使用 (single-instance 引数も無視している)。
fn validate_arg_path(arg: &str) -> Option<PathBuf> {
    // canonicalize は存在しないパスでエラーになるため、存在チェックも兼ねる
    let canon = std::fs::canonicalize(arg).ok()?;

    // 許可ベース: $PICTURE/VRChat (assetProtocol.scope と一致させる)
    let userprofile = std::env::var("USERPROFILE").ok()?;
    let base =
        std::fs::canonicalize(PathBuf::from(userprofile).join("Pictures").join("VRChat")).ok()?;

    if canon.starts_with(&base) {
        Some(canon)
    } else {
        None
    }
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
            // FATAL は [ERROR][app] レベル prefix に揃える (L6 Log-2)
            logging::log_error("app", &format!("Mira DB の初期化に失敗しました: {e}"));
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
        // 多重起動防止: 2 つ目のインスタンスは即時 exit させ、初回インスタンスを生かす (H11)。
        // コールバックは現状フォーカス処理を行わない (Mira は単一 main ウィンドウ前提で
        // Tauri 内部の WebView2 が前面に出る挙動に委ねる)。
        // L3 R3-Sec-2: 受け取った _args は現状未使用だが、将来 CLI でファイルパスを受け取る
        // 拡張に備えて長さ上限のサニティチェックを入れる (DoS / 過大入力の早期防御)。
        //   - 要素数上限: 100 (実用上の CLI 引数として十分)
        //   - 各要素長上限: 1024 文字 (Windows パス上限 + 余裕)
        // 超過時は無視 (現状フォーカス処理もしないため挙動同じ)。
        // パストラバーサル検証は `validate_arg_path()` に実装済み (現状未使用)。
        // 将来 CLI でファイルパスを受け取る拡張を入れる場合は、各引数を
        // `validate_arg_path()` に通してから利用すること。
        .plugin(tauri_plugin_single_instance::init(|_app, args, _cwd| {
            const MAX_ARGS: usize = 100;
            const MAX_ARG_LEN: usize = 1024;
            let arg_count = args.len();
            if arg_count > MAX_ARGS {
                logging::log_warn(
                    "single-instance",
                    &format!("引数数が上限超過 ({arg_count} > {MAX_ARGS}); 無視します"),
                );
            } else if args.iter().any(|a| a.len() > MAX_ARG_LEN) {
                logging::log_warn(
                    "single-instance",
                    &format!("引数長が上限 ({MAX_ARG_LEN} chars) 超過; 無視します"),
                );
            }
            // 現状はフォーカス処理なし (将来拡張ポイント)。
            // サニティチェックを通過しても何もしない。
        }))
        .manage(db_state)
        // L6 Log-9: 起動完了のマーカーを INFO ログに残す。
        //   `setup` ハンドラは全 plugin / manage / invoke_handler が登録され、
        //   Tauri が WebView を起こす直前に呼ばれるため、ここで `startup_completed`
        //   を出力すれば「起動初期化を最後まで通過した」事実が分かる。
        //   失敗時 (setup 内 panic / Err) は通常の panic hook + FATAL 経路に乗る。
        .setup(|_app| {
            logging::log_info("app", "startup_completed");
            Ok(())
        })
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
            commands::calendar::update_calendar_event,
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
        // FATAL は [ERROR][app] レベル prefix に揃える (L6 Log-2)
        logging::log_error("app", &format!("Mira の起動に失敗しました: {err}"));
    }
}
