//! `StellaRecord` との連携コマンド。
//! - `StellaRecord` DB の存在確認 (`check_stellarecord_available`)
//! - `StellaRecord` の `apps` テーブルへ Mira 自身を登録 / 解除
//!
//! Mira から `StellaRecord` 領域への書き込み (apps テーブル) は最小限に抑える。

use rusqlite::Connection;
use tauri::Manager;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

/// `StellaRecord` 本体 (src-tauri/src/analyze/db.rs) と一致させた apps テーブル。
/// 旧バージョンの `STELLARecord` にはこのテーブルが無いため、register 時に IF NOT EXISTS で作る。
/// category 列は削除済み、UNIQUE は path に移管済み。
const APPS_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS apps (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    path            TEXT NOT NULL UNIQUE,
    icon            BLOB,
    registered_at   DATETIME DEFAULT (datetime('now', 'localtime'))
);
";

/// `STELLARecord` DB のパスをレジストリから解決する (新レイアウト優先 → 旧 `DbPath` フォールバック)
fn get_stellarecord_db_path() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(r"Software\CosmoArtsStore\StellaRecord")
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

    // 旧バージョン互換 (Mira が直接書いた DbPath レジストリ値)
    key.get_value("DbPath").ok()
}

/// `STELLARecord` DB ファイルの実在を確認する (UI のオンボーディング判定で使う)
#[tauri::command]
pub fn check_stellarecord_available() -> bool {
    get_stellarecord_db_path()
        .is_some_and(|p| std::path::Path::new(&p).exists())
}

/// `StellaRecord` に Mira を登録する
///
/// R2-M-12: 既存レコードが存在しパスも一致する場合は INSERT OR REPLACE で
/// 毎回 ~1MB の icon BLOB を再書込していた。SELECT で既存値を確認し、
/// (path, icon) が変わっていない場合は UPDATE 自体を行わない。
#[tauri::command]
pub fn register_to_stellarecord(app: tauri::AppHandle) -> Result<String, String> {
    let db_path = get_stellarecord_db_path()
        .ok_or_else(|| "StellaRecord がインストールされていません".to_string())?;

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("DB を開けませんでした: {e}"))?;

    conn.execute_batch(APPS_SCHEMA)
        .map_err(|e| format!("テーブル作成に失敗しました: {e}"))?;

    let exe_path = std::env::current_exe()
        .map_err(|e| format!("実行パスを取得できませんでした: {e}"))?;
    let exe_str = exe_path.to_string_lossy().to_string();

    let icon_data = load_app_icon(&app);

    // 既存レコードの icon を path で取得（UNIQUE が path のため）
    let existing_icon: Option<Option<Vec<u8>>> = conn
        .query_row(
            "SELECT icon FROM apps WHERE path = ?1",
            [&exe_str],
            |row| {
                let i: Option<Vec<u8>> = row.get(0)?;
                Ok(i)
            },
        )
        .ok();

    if let Some(cur_icon) = existing_icon {
        // icon が変わっていなければ書き込みをスキップ（毎回 ~1MB BLOB を再書込するのを防ぐ）
        if cur_icon == icon_data {
            return Ok("StellaRecord に既に登録済みです (差分なし)".to_string());
        }
    }

    // upsert: path で衝突したら name/description/icon を更新する
    conn.execute(
        "INSERT INTO apps (name, description, path, icon)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET
             name = excluded.name,
             description = excluded.description,
             icon = excluded.icon",
        rusqlite::params![
            "Mira",
            "VRChat活動ジャーナル",
            exe_str,
            icon_data,
        ],
    )
    .map_err(|e| format!("登録に失敗しました: {e}"))?;

    Ok("StellaRecord に登録しました".to_string())
}

/// `STELLARecord` の apps テーブルから Mira を登録解除する (アンインストール時の後片付け用)
#[tauri::command]
pub fn unregister_from_stellarecord() -> Result<String, String> {
    let db_path = get_stellarecord_db_path()
        .ok_or_else(|| "StellaRecord がインストールされていません".to_string())?;

    if !std::path::Path::new(&db_path).exists() {
        return Ok("DB が存在しないため削除不要です".to_string());
    }

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("DB を開けませんでした: {e}"))?;

    // 自身の exe path を主キーとして削除する（複数インストールに耐性）
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("実行パスを取得できませんでした: {e}"))?;
    let exe_str = exe_path.to_string_lossy().to_string();
    conn.execute("DELETE FROM apps WHERE path = ?1", rusqlite::params![exe_str])
        .map_err(|e| format!("登録解除に失敗しました: {e}"))?;

    Ok("StellaRecord から登録解除しました".to_string())
}

/// アプリアイコン (128x128.png 優先、無ければ icon.png) をリソース配下から読み出して BLOB として返す
fn load_app_icon(app: &tauri::AppHandle) -> Option<Vec<u8>> {
    let resource_dir = app.path().resource_dir().ok()?;
    let icon_path = resource_dir.join("icons").join("128x128.png");
    if icon_path.exists() {
        return std::fs::read(&icon_path).ok();
    }
    let icon_path = resource_dir.join("icons").join("icon.png");
    if icon_path.exists() {
        return std::fs::read(&icon_path).ok();
    }
    None
}