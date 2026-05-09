pub mod mira_db;
pub mod migrations;
pub mod stella_db;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct DbState {
    pub mira: Mutex<Connection>,
    pub stella: Mutex<Option<Connection>>,
}

pub fn initialize() -> Result<DbState, String> {
    let mira_conn = mira_db::open_or_create().map_err(|e| format!("Mira DB error: {}", e))?;
    let stella_conn = stella_db::try_connect();

    Ok(DbState {
        mira: Mutex::new(mira_conn),
        stella: Mutex::new(stella_conn),
    })
}
