use rusqlite::{Connection, OpenFlags};
use winreg::enums::*;
use winreg::RegKey;

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

fn find_stella_db_path() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey("Software\\CosmoArtsStore\\StellaRecord")
        .ok()?;

    // New layout: InstallLocation + Data\db\stellarecord.db
    if let Ok(install_dir) = key.get_value::<String, _>("InstallLocation") {
        let new_path = std::path::PathBuf::from(&install_dir)
            .join("Data")
            .join("db")
            .join("stellarecord.db");
        if new_path.exists() {
            return Some(new_path.to_string_lossy().to_string());
        }
    }

    // Legacy fallback: DbPath key
    key.get_value("DbPath").ok()
}
