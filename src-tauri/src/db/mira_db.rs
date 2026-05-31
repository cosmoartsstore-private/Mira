//! Mira 専用 `SQLite` DB のオープン・初期化。
//! データディレクトリは 3 段階フォールバック (レジストリ `InstallLocation` → exe 隣 →
//! `LOCALAPPDATA\CosmoArtsStore\Mira\Data`) で決定し、WAL モード + `foreign_keys` ON で開く。
//! スキーマ DDL とマイグレーションは [`super::migrations`] に委譲する。

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use super::migrations;

/// mira.db のフルパスを返す。存在しなければ親ディレクトリを作成する。
/// 解決順は `get_install_data_dir` → LOCALAPPDATA フォールバック。
pub fn get_db_path() -> PathBuf {
    let dir = get_install_data_dir().unwrap_or_else(|| {
        // インストーラレジストリが無い場合 (開発ビルドや手動配置) のフォールバック
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(local_app_data)
            .join("CosmoArtsStore")
            .join("Mira")
            .join("Data")
            .join("db")
    });
    std::fs::create_dir_all(&dir).ok();
    dir.join("mira.db")
}

/// インストーラが書いたレジストリから DB 親ディレクトリ (<InstallLocation>\Data\db) を取り出す。
/// レジストリキーが無いか値が取れなければ None。
fn get_install_data_dir() -> Option<PathBuf> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\CosmoArtsStore\Mira").ok()?;
    let install_dir: String = key.get_value("InstallLocation").ok()?;
    let dir = PathBuf::from(install_dir).join("Data").join("db");
    Some(dir)
}

/// Mira DB を開く（無ければ作成）。
/// - WAL: 並列読み + 書きを許すジャーナルモード。長時間ロックを避けるため必須。
/// - `foreign_keys`: `SQLite` はデフォルトで FK 無効なので明示的に ON にする。
/// - 続けて `migrations::run` でテーブル作成・カラム追加・デフォルト設定投入を行う。
pub fn open_or_create() -> Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(&path)?;

    conn.execute_batch("PRAGMA journal_mode = WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    migrations::run(&conn)?;

    Ok(conn)
}
