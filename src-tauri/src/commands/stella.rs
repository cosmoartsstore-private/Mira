//! `StellaRecord` との連携コマンド。
//! - `StellaRecord` DB の存在確認 (`check_stellarecord_available`)
//! - `StellaRecord` の `apps` テーブルへ Mira 自身を登録 / 解除
//!
//! Mira から `StellaRecord` 領域への書き込み (apps テーブル) は最小限に抑える。
//!
//! L3 R3-Sec-7: パストラバーサル防御に関する設計メモ。
//! 現状 `src-tauri/src/commands/` 配下の全コマンドにおいて、フロントエンドから
//! 渡される文字列を直接ファイルパスとして組み立てる経路は存在しない:
//! - `stella.rs`   : DB パスは Windows レジストリから取得し、アイコンパスは Tauri 提供の
//!   `app.path().resource_dir()` 起点で `.join()` する固定リテラルのみ。
//! - `journal.rs`  : DB パスは内部固定で、ユーザー入力 (date/memo/marker) はすべて
//!   SQL バインドにのみ使用 (パス連結に使われる経路なし)。
//! - `calendar.rs` : 同上。
//! - `startup.rs`  : 同上。
//!
//! よって `canonicalize()` + ベースディレクトリ prefix チェックは現時点で不要。
//! 将来 CLI 引数や IPC でファイルパスを受け取る経路を追加する場合は、
//! その時点で同等の検証を導入する (`lib.rs` の TODO 参照)。

use rusqlite::Connection;
use tauri::Manager;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

/// `StellaRecord` 本体 (src-tauri/src/analyze/db.rs) と一致させた apps テーブル。
/// 旧バージョンの `StellaRecord` にはこのテーブルが無いため、register 時に IF NOT EXISTS で作る。
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

/// `StellaRecord` DB のパスをレジストリから解決する (新レイアウト優先 → 旧 `DbPath` フォールバック)
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

/// `StellaRecord` DB ファイルの実在を確認する (UI のオンボーディング判定で使う)
#[tauri::command]
pub fn check_stellarecord_available() -> bool {
    get_stellarecord_db_path().is_some_and(|p| std::path::Path::new(&p).exists())
}

/// `StellaRecord` に Mira を登録する
///
/// R2-M-12: 既存レコードが存在しパスも一致する場合は INSERT OR REPLACE で
/// 毎回 ~1MB の icon BLOB を再書込していた。SELECT で既存値を確認し、
/// (name, description, icon) が全て変わっていない場合は UPDATE 自体を行わない。
/// R2-M-25: 比較対象に name/description も含める (旧実装は icon のみ比較で
/// 表示名・説明変更が反映されなかった)。
#[tauri::command]
pub fn register_to_stellarecord(app: tauri::AppHandle) -> Result<String, String> {
    const APP_NAME: &str = "Mira";
    const APP_DESCRIPTION: &str = "VRChat活動ジャーナル";

    let db_path = get_stellarecord_db_path()
        .ok_or_else(|| "StellaRecord がインストールされていません".to_string())?;

    let conn = Connection::open(&db_path).map_err(|e| format!("DB を開けませんでした: {e}"))?;

    conn.execute_batch(APPS_SCHEMA)
        .map_err(|e| format!("テーブル作成に失敗しました: {e}"))?;

    let exe_path =
        std::env::current_exe().map_err(|e| format!("実行パスを取得できませんでした: {e}"))?;
    let exe_str = exe_path.to_string_lossy().to_string();

    let icon_data = load_app_icon(&app);

    // 既存レコードの (name, description, icon) を path で取得 (UNIQUE が path のため)
    let existing: Option<(String, String, Option<Vec<u8>>)> = conn
        .query_row(
            "SELECT name, description, icon FROM apps WHERE path = ?1",
            [&exe_str],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();

    if let Some((cur_name, cur_desc, cur_icon)) = existing {
        // 全フィールド一致なら書き込みをスキップ (毎回 ~1MB BLOB を再書込するのを防ぐ)
        if cur_name == APP_NAME && cur_desc == APP_DESCRIPTION && cur_icon == icon_data {
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
        rusqlite::params![APP_NAME, APP_DESCRIPTION, exe_str, icon_data],
    )
    .map_err(|e| format!("登録に失敗しました: {e}"))?;

    Ok("StellaRecord に登録しました".to_string())
}

/// `StellaRecord` の apps テーブルから Mira を登録解除する (アンインストール時の後片付け用)
#[tauri::command]
pub fn unregister_from_stellarecord() -> Result<String, String> {
    let db_path = get_stellarecord_db_path()
        .ok_or_else(|| "StellaRecord がインストールされていません".to_string())?;

    if !std::path::Path::new(&db_path).exists() {
        return Ok("DB が存在しないため削除不要です".to_string());
    }

    let conn = Connection::open(&db_path).map_err(|e| format!("DB を開けませんでした: {e}"))?;

    // 自身の exe path を主キーとして削除する（複数インストールに耐性）
    let exe_path =
        std::env::current_exe().map_err(|e| format!("実行パスを取得できませんでした: {e}"))?;
    let exe_str = exe_path.to_string_lossy().to_string();
    conn.execute(
        "DELETE FROM apps WHERE path = ?1",
        rusqlite::params![exe_str],
    )
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
