//! Tauri に `manage()` させる共有 DB ステートと、両 DB を開く初期化処理。
//! ハンドラからのロック取得は本モジュールの [`lock_mira`] / [`lock_stella`] ヘルパー経由で行う。

pub mod migrations;
pub mod mira_db;
pub mod stella_db;

use rusqlite::Connection;
use std::sync::{Mutex, MutexGuard};
use tauri::State;

/// Tauri に `manage()` させる共有 DB ステート。
/// - `mira`: Mira 専用 DB。書込可能。アプリ起動時に必ず取得できる前提（取れなければ起動失敗）。
/// - `stella`: `StellaRecord` 読み取り専用 DB。未インストールなら `None` のままで動く。
///
/// どちらも `Mutex` 包みなので、ハンドラからは [`lock_mira`] / [`lock_stella`] でアクセスする。
pub struct DbState {
    pub mira: Mutex<Connection>,
    pub stella: Mutex<Option<Connection>>,
}

/// 両 DB を開いて `DbState` を組み立てる。Mira DB の作成失敗のみ致命扱い。
/// `StellaRecord` 未接続は正常系として扱い、`stellaConnected=false` で UI 側に伝える。
///
/// # Errors
/// Mira DB のオープン・初期化・マイグレーションのいずれかが失敗した場合にエラーを返す。
pub fn initialize() -> Result<DbState, String> {
    let mira_conn = mira_db::open_or_create().map_err(|e| format!("Mira DB error: {e}"))?;
    let stella_conn = stella_db::try_connect();

    Ok(DbState {
        mira: Mutex::new(mira_conn),
        stella: Mutex::new(stella_conn),
    })
}

/// Mira DB の `Mutex` をロックして取得する。poisoned な場合はユーザー向けエラー文字列を返す。
///
/// # Errors
/// 別スレッドの panic 等で `Mutex` が poisoned になっている場合にエラーを返す。
pub fn lock_mira<'a>(state: &'a State<'_, DbState>) -> Result<MutexGuard<'a, Connection>, String> {
    state
        .mira
        .lock()
        .map_err(|_| "Mira DB のロック取得に失敗しました".to_string())
}

/// `StellaRecord` DB の `Mutex` をロックして取得する。中身は未接続時 `None`。
///
/// # Errors
/// 別スレッドの panic 等で `Mutex` が poisoned になっている場合にエラーを返す。
pub fn lock_stella<'a>(
    state: &'a State<'_, DbState>,
) -> Result<MutexGuard<'a, Option<Connection>>, String> {
    state
        .stella
        .lock()
        .map_err(|_| "StellaRecord DB のロック取得に失敗しました".to_string())
}
