//! `StellaRecord` DB への読み取り専用接続ヘルパー。
//! レジストリ `HKCU\Software\CosmoArtsStore\StellaRecord\InstallLocation` を引いて
//! `Data\db\stellarecord.db` を読込専用で開く。旧 `DbPath` 値にもフォールバック。
//! `StellaRecord` 未インストール時は `None` を返し、Mira の主機能は引き続き動く。

use rusqlite::{Connection, OpenFlags};
use std::time::Duration;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

/// `StellaRecord` DB に「読み取り専用」で接続を試みる。未インストール/ファイル無し時は None。
///
/// フラグの意図:
/// - `SQLITE_OPEN_READ_ONLY`: 他アプリ (Mira) の書込みで `StellaRecord` 本体を壊さないため。
/// - `SQLITE_OPEN_NO_MUTEX`: 内部のスレッドロックを外す（DbState の Mutex で外側ロック済みなので不要）。
/// - 加えて実行時 PRAGMA `query_only = ON` で SELECT 以外をブロックし、二重に書込み事故を防ぐ。
pub fn try_connect() -> Option<Connection> {
    let db_path = find_stella_db_path()?;

    if !std::path::Path::new(&db_path).exists() {
        return None;
    }

    // NO_MUTEX は使用しない (デフォルトの SERIALIZED モードで多重アクセスを直列化させる)
    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;

    // StellaRecord 側の書込で一時的にロックがかかった場合に備え、5 秒の待機を許容する。
    if let Err(e) = conn.busy_timeout(Duration::from_secs(5)) {
        eprintln!("[db] StellaRecord busy_timeout 設定失敗: {e}");
    }
    // L2 R2-13: 分離レベルを明示する。
    //   - `query_only = ON`        : SELECT 以外を一律拒否 (二重防御)。
    //   - `read_uncommitted = OFF` : SQLite の既定 (= SERIALIZABLE 相当) を明示。
    //     既定値だが、別バージョン / 別ビルドで ON にされる将来リスクを排する。
    // L3 R3-Sec-1: PRAGMA 失敗時は警告ログを残し、接続自体は返す (起動継続)。
    //   query_only は二重防御のため失敗しても致命ではない (上位は SELECT のみ実行する)。
    if let Err(e) = conn.execute_batch(
        "PRAGMA query_only = ON;
         PRAGMA read_uncommitted = OFF;",
    ) {
        eprintln!("[db] StellaRecord PRAGMA 設定失敗: {e}");
    }

    Some(conn)
}

/// `StellaRecord` DB のパスをレジストリから引く。
/// 新レイアウト (`InstallLocation` 配下) を優先し、見つからなければ旧 `DbPath` にフォールバック。
fn find_stella_db_path() -> Option<String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey("Software\\CosmoArtsStore\\StellaRecord")
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

    // 旧バージョン (Mira < x.x) で直接書かれていた DbPath 値
    key.get_value("DbPath").ok()
}
