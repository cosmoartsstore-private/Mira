pub mod mira_db;
pub mod migrations;
pub mod stella_db;

use rusqlite::Connection;
use std::sync::Mutex;

/// Tauri に manage() させる共有 DB ステート。
/// - `mira`: Mira 専用 DB。書込可能。アプリ起動時に必ず取得できる前提（取れなければ起動失敗）。
/// - `stella`: STELLARecord 読み取り専用 DB。未インストールなら `None` のままで動く。
///
/// どちらも Mutex 包みなので、ハンドラからは `state.mira.lock().unwrap()` の形でアクセスする。
pub struct DbState {
    pub mira: Mutex<Connection>,
    pub stella: Mutex<Option<Connection>>,
}

/// 両 DB を開いて DbState を組み立てる。Mira DB の作成失敗のみ致命扱い。
/// STELLARecord 未接続は正常系として扱い、`stellaConnected=false` で UI 側に伝える。
pub fn initialize() -> Result<DbState, String> {
    let mira_conn = mira_db::open_or_create().map_err(|e| format!("Mira DB error: {}", e))?;
    let stella_conn = stella_db::try_connect();

    Ok(DbState {
        mira: Mutex::new(mira_conn),
        stella: Mutex::new(stella_conn),
    })
}
