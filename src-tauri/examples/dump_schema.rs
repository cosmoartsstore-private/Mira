use rusqlite::{Connection, OpenFlags};
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;

fn main() {
    let db_path = find_stella_db_path().expect(
        "StellaRecord DB not found. Ensure StellaRecord is installed and \
         HKCU\\Software\\CosmoArtsStore\\StellaRecord has InstallLocation or DbPath.",
    );

    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();

    let mut stmt = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND sql IS NOT NULL ORDER BY name")
        .unwrap();
    let schemas: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    for s in schemas {
        println!("{};", s);
        println!();
    }
}

fn find_stella_db_path() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(r"Software\CosmoArtsStore\StellaRecord")
        .ok()?;

    // New layout: InstallLocation + Data\db\stellarecord.db
    if let Ok(install_dir) = key.get_value::<String, _>("InstallLocation") {
        let new_path = PathBuf::from(&install_dir)
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
