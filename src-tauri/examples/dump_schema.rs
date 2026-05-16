//! 開発支援ツール: `StellaRecord` の DB スキーマを `sqlite_master` から読み出して `CREATE` 文として標準出力に吐く。
//! `cargo run --example dump_schema` で実行する想定で、本体バイナリ (`tauri build`) には含まれない。
//! 例外パスはユーザーに見せず、stderr に出して非ゼロ終了する。

// 開発用 example のため、本体クレートの clippy 規律 (`unwrap_used`/`expect_used`/`print_stdout` deny) は緩める。
#![allow(
    clippy::print_stdout,
    clippy::uninlined_format_args,
    clippy::redundant_closure_for_method_calls
)]

use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use std::process::ExitCode;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

fn main() -> ExitCode {
    let Some(db_path) = find_stella_db_path() else {
        eprintln!(
            "StellaRecord DB が見つかりません。\
             HKCU\\Software\\CosmoArtsStore\\StellaRecord の InstallLocation または DbPath を確認してください。"
        );
        return ExitCode::FAILURE;
    };

    let conn = match Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("DB を読み取り専用で開けませんでした [{}]: {e}", db_path);
            return ExitCode::FAILURE;
        }
    };

    let mut stmt = match conn.prepare(
        "SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND sql IS NOT NULL ORDER BY name",
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("sqlite_master のクエリ準備に失敗しました: {e}");
            return ExitCode::FAILURE;
        }
    };

    let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("sqlite_master のクエリ実行に失敗しました: {e}");
            return ExitCode::FAILURE;
        }
    };

    for s in rows.filter_map(Result::ok) {
        println!("{};", s);
        println!();
    }
    ExitCode::SUCCESS
}

/// `HKCU\Software\CosmoArtsStore\StellaRecord` から DB ファイルパスを解決する。
/// 新方式 `InstallLocation\Data\db\stellarecord.db` を優先し、無ければ旧 `DbPath` キーにフォールバック。
fn find_stella_db_path() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(r"Software\CosmoArtsStore\StellaRecord")
        .ok()?;

    // 新レイアウト: `InstallLocation\Data\db\stellarecord.db`
    if let Ok(install_dir) = key.get_value::<String, _>("InstallLocation") {
        let new_path = PathBuf::from(&install_dir)
            .join("Data")
            .join("db")
            .join("stellarecord.db");
        if new_path.exists() {
            return Some(new_path.to_string_lossy().to_string());
        }
    }

    // 旧レイアウトフォールバック: `DbPath` キー
    key.get_value("DbPath").ok()
}
