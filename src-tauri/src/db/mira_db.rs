use rusqlite::{Connection, Result};
use std::path::PathBuf;
use winreg::enums::*;
use winreg::RegKey;

use super::migrations;

pub fn get_db_path() -> PathBuf {
    // Prefer InstallLocation from registry (set by installer)
    let dir = get_install_data_dir().unwrap_or_else(|| {
        // Fallback: $LOCALAPPDATA\CosmoArtsStore\Mira\Data\db
        let local_app_data =
            std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(local_app_data)
            .join("CosmoArtsStore")
            .join("Mira")
            .join("Data")
            .join("db")
    });
    std::fs::create_dir_all(&dir).ok();
    dir.join("mira.db")
}

fn get_install_data_dir() -> Option<PathBuf> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\CosmoArtsStore\Mira").ok()?;
    let install_dir: String = key.get_value("InstallLocation").ok()?;
    let dir = PathBuf::from(install_dir).join("Data").join("db");
    Some(dir)
}

pub fn open_or_create() -> Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(&path)?;

    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    migrations::run(&conn)?;

    Ok(conn)
}
