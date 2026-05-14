use rusqlite::{Connection, OpenFlags};
use winreg::enums::*;
use winreg::RegKey;

/// STELLARecord DB に「読み取り専用」で接続を試みる。未インストール/ファイル無し時は None。
///
/// フラグの意図:
/// - `SQLITE_OPEN_READ_ONLY`: 他アプリ (Mira) の書込みで STELLARecord 本体を壊さないため。
/// - `SQLITE_OPEN_NO_MUTEX`: 内部のスレッドロックを外す（DbState の Mutex で外側ロック済みなので不要）。
/// - 加えて実行時 PRAGMA `query_only = ON` で SELECT 以外をブロックし、二重に書込み事故を防ぐ。
pub fn try_connect() -> Option<Connection> {
    let db_path = find_stella_db_path()?;

    if !std::path::Path::new(&db_path).exists() {
        return None;
    }

    let conn = Connection::open_with_flags(
        &db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;

    conn.execute_batch("PRAGMA query_only = ON;").ok()?;

    Some(conn)
}

/// STELLARecord DB のパスをレジストリから引く。
/// 新レイアウト (InstallLocation 配下) を優先し、見つからなければ旧 DbPath にフォールバック。
fn find_stella_db_path() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey("Software\\CosmoArtsStore\\StellaRecord")
        .ok()?;

    // 新レイアウト: <InstallLocation>\Data\db\stellarecord.db
    if let Ok(install_dir) = key.get_value::<String, _>("InstallLocation") {
        let new_path = std::path::PathBuf::from(&install_dir)
            .join("Data")
            .join("db")
            .join("stellarecord.db");
        if new_path.exists() {
            return Some(new_path.to_string_lossy().to_string());
        }
    }

    // 旧バージョン (Mira < x.x) で直接書かれていた DbPath 値
    key.get_value("DbPath").ok()
}
