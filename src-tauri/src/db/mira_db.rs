//! Mira 専用 `SQLite` DB のオープン・初期化。
//! データディレクトリは 3 段階フォールバック (レジストリ `InstallLocation` → exe 隣 →
//! `LOCALAPPDATA\CosmoArtsStore\Mira\Data`) で決定し、WAL モード + `foreign_keys` ON で開く。
//! スキーマ DDL とマイグレーションは [`super::migrations`] に委譲する。

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::time::Duration;
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

    // 並列ハンドラ間のロック衝突で即時 SQLITE_BUSY を返さないよう、5 秒の待機を許容する。
    conn.busy_timeout(Duration::from_secs(5))?;
    // L3 R3-Sec-1 / L4 R4-Err-2: WAL/FK 設定失敗の扱いを分離する。
    //   - WAL 失敗: rollback journal にフォールバックしても整合性は保たれるため warn のみで継続。
    //   - foreign_keys 失敗: 後続マイグレーションが FK 前提で書かれており、
    //     OFF のままだと参照整合性が壊れるリスクがある (orphan 行の生成許容)。
    //     起動を継続するとデータ破損を発生させる可能性があるため fatal 化する。
    if let Err(e) = conn.execute_batch("PRAGMA journal_mode = WAL;") {
        crate::utils::logging::log_warn("db", &format!("WAL mode 設定失敗: {e}"));
    }
    if let Err(e) = conn.execute_batch("PRAGMA foreign_keys = ON;") {
        crate::utils::logging::log_error("db", &format!("foreign_keys 設定失敗 (fatal): {e}"));
        return Err(e);
    }

    migrations::run(&conn)?;

    Ok(conn)
}
