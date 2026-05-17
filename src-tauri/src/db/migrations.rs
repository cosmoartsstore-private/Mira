//! Mira DB のスキーマ DDL とマイグレーション処理。
//! `CREATE TABLE IF NOT EXISTS` 群と、`pragma_table_info` ベースで列の存在を確認してから
//! ALTER / DROP する防御的マイグレーション関数を提供する。
//!
//! スキーマバージョン管理: `PRAGMA user_version` を使い、必要なステップだけを順序通りに
//! 適用する。各ステップ自体は冪等 (`IF NOT EXISTS` / `pragma_table_info` チェック) を
//! 維持しているため、既存環境からの再実行も安全。
//!
//! CHECK 制約方針 (M13): `recurrence_kind` のような後付けカラムには
//! `ADD COLUMN ... CHECK (...)` で遡及適用しても既存行に対しては検証されない
//! (`SQLite` 仕様)。アプリ層 (`commands::calendar::add_event` 等) のバリデーションで
//! 不正値の混入を防いでいるため、DB レベルの CHECK は新規テーブル定義時のみ付与する。
//!
//! L2 R2 追加方針:
//! - `mira_manual_markers` の `date` には FK + ON DELETE CASCADE を付けたいが、既存
//!   テーブルへの FK 追加は `SQLite` では不可。次の major 再作成時に統合し、それまでは
//!   `commands` 側で `mira_journal_entries` 削除時に手動 cleanup する (現状仕様上
//!   journal 行の削除パスは存在しないが、将来追加する際はこのコメントに従うこと)。
//! - `mira_scheduled_events(title, scheduled_at)` の UNIQUE 制約も既存重複データを
//!   保持したまま付与するため、`UNIQUE INDEX IF NOT EXISTS` で代替する。
//! - `is_recurring` / `recurrence_kind` 一貫性は新規 CREATE 時のみ CHECK で保証。
//!   既存データへの遡及は不可なのでアプリ層 (`calendar::add_event` 等) で保証する。

use rusqlite::{Connection, Result};

/// 現行スキーマバージョン。新しい不可逆マイグレーションを追加するたびに +1 する。
const CURRENT_SCHEMA_VERSION: i64 = 1;

/// Mira DB を最新スキーマに揃える。
/// 1. `PRAGMA user_version` で現在のスキーマバージョンを取得
/// 2. 未適用のステップを順に実行 (各ステップは冪等)
/// 3. 完了後に `user_version` を `CURRENT_SCHEMA_VERSION` に固定
///
/// 連番工程のため 1 関数に集約。スキーマ DDL リテラルが大半を占めるので
/// `too_many_lines` は許容する。
#[allow(clippy::too_many_lines)]
pub fn run(conn: &Connection) -> Result<()> {
    let from_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);

    // ステップ 0 -> 1: 初期スキーマ + 既存全マイグレーション (新規環境含め必ず通る)。
    // 既存ユーザー (user_version=0 のまま動いてきた環境) も再実行で実害は無い (全工程冪等)。
    if from_version < 1 {
        apply_v1(conn)?;
    }

    // 新しいマイグレーションを足す時はここに if from_version < N { apply_vN(conn)?; } を追加する。

    conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)?;
    Ok(())
}

/// v1 マイグレーション: 初期スキーマ生成と、既知の互換補正・デフォルト値投入をまとめて適用する。
///
/// L6 Log-8: 開始 / 完了をログに残し、起動失敗時の切り分け (DB マイグレーションまで到達したか / その途中か)
/// を運用ログから即座に判定できるようにする。失敗時は呼出側 (`run()` の `?`) が伝搬する。
#[allow(clippy::too_many_lines)]
fn apply_v1(conn: &Connection) -> Result<()> {
    crate::utils::logging::log_info("migrations", "v1 apply start");
    let result = apply_v1_inner(conn);
    match &result {
        Ok(()) => crate::utils::logging::log_info("migrations", "v1 apply done"),
        Err(e) => crate::utils::logging::log_error("migrations", &format!("v1 apply failed: {e}")),
    }
    result
}

#[allow(clippy::too_many_lines)]
fn apply_v1_inner(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        -- L2 R2-10: data_version は未使用 (旧仕様の名残) のため新規 CREATE からは除去。
        -- 既存環境では下の drop_column_if_exists で撤去する。
        CREATE TABLE IF NOT EXISTS mira_journal_entries (
            date              TEXT PRIMARY KEY,
            user_memo         TEXT,
            created_at        DATETIME NOT NULL,
            updated_at        DATETIME NOT NULL
        );

        -- is_recurring / recurrence_kind / reminded / last_fired_at の一貫性は
        -- 新規 CREATE 時のみ CHECK で保証する (ADD COLUMN による遡及 CHECK は
        -- 既存行を検証しないため、既存環境への適用はアプリ層保証で代替)。
        CREATE TABLE IF NOT EXISTS mira_scheduled_events (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type        TEXT NOT NULL CHECK (event_type IN ('reservation')),
            title             TEXT NOT NULL,
            scheduled_at      DATETIME NOT NULL,
            source            TEXT NOT NULL CHECK (source IN ('user')),
            source_ref        TEXT,
            notify_on_launch  BOOLEAN NOT NULL DEFAULT 1 CHECK (notify_on_launch IN (0, 1)),
            is_recurring      BOOLEAN NOT NULL DEFAULT 0 CHECK (is_recurring IN (0, 1)),
            created_at        DATETIME NOT NULL
        );

        -- is_custom: ユーザーがワールド色を手動変更したか (将来 UI 用予約フラグ、現状は常に 0)
        -- R2-M-26: world_name を主キーとする (StellaRecord 側に wrld_xxx を一意保存する経路が無い)
        CREATE TABLE IF NOT EXISTS mira_world_colors (
            world_name  TEXT PRIMARY KEY,
            color_hex   TEXT NOT NULL,
            is_custom   BOOLEAN NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1))
        );

        -- L2 R2-1/2/11: FK + CASCADE + 色 CHECK 制約は新規 CREATE 時のみ付与。
        -- 既存テーブルへの FK / CHECK 追加は SQLite 仕様上不可なので
        -- 旧環境では手動 cleanup (mira_journal_entries 削除パスは未実装) でカバーする。
        CREATE TABLE IF NOT EXISTS mira_manual_markers (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            date      TEXT NOT NULL,
            start_pos INTEGER NOT NULL,
            end_pos   INTEGER NOT NULL,
            color     TEXT NOT NULL DEFAULT 'red' CHECK (color IN ('red','blue','green','orange')),
            CHECK (start_pos < end_pos),
            FOREIGN KEY (date) REFERENCES mira_journal_entries(date) ON DELETE CASCADE
        );

        -- L2 R2-6: value_type で「文字列に詰めた値の本来の型」を表現する。
        -- 'bool' / 'int' / 'text' の 3 種を想定。bool キーは set_setting で強制セット、
        -- get_settings は型情報を見ずに従来通りパース済 (フロント互換維持)。
        CREATE TABLE IF NOT EXISTS mira_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            value_type TEXT NOT NULL DEFAULT 'text'
        );

        -- source_ref: 現状は mira_scheduled_events.id を文字列化して格納 (将来 snapshot 等の他通知種別にも対応するための汎用カラム)
        CREATE TABLE IF NOT EXISTS mira_dismissed_events (
            source_ref   TEXT PRIMARY KEY,
            dismissed_at DATETIME NOT NULL
        );
        ",
    )?;

    // 廃止テーブル / 廃止カラムの撤去 (DROP IF EXISTS で冪等)
    // R2-M-23: お気に入りユーザー機能は UI 配線が無く dead 判定されたため撤去 (2026-05-17)
    conn.execute_batch("DROP TABLE IF EXISTS mira_favorite_users;")?;
    // R2-M-24: 旧スキーマで予約だけされ実装されなかったカラムを撤去 (2026-05-17)
    drop_column_if_exists(conn, "mira_journal_entries", "template_id")?;
    drop_column_if_exists(conn, "mira_journal_entries", "generated_summary")?;
    drop_column_if_exists(conn, "mira_scheduled_events", "description")?;
    // L2 R2-10: data_version は誰も使わず ('1' を入れるだけの dead field) なので撤去
    drop_column_if_exists(conn, "mira_journal_entries", "data_version")?;
    // R2-M-26 / L2 R2-23: mira_world_colors の主キーを world_id → world_name に切替 (2026-05-17)
    // pre-release 時の破壊的変更: 旧テーブルの色データは全消失するが、Mira は決定論的
    // 色生成 (FNV-1a ハッシュ) を採用しているため再アクセス時に同じ色が割り当てられる。
    // ユーザーが手動で塗り替えた色 (is_custom=1) が万一存在しても、pre-release 期間中の
    // 仕様明示として既存データロスは許容する。
    if column_exists(conn, "mira_world_colors", "world_id")? {
        conn.execute_batch(
            "
            DROP TABLE mira_world_colors;
            CREATE TABLE mira_world_colors (
                world_name  TEXT PRIMARY KEY,
                color_hex   TEXT NOT NULL,
                is_custom   BOOLEAN NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1))
            );
            ",
        )?;
    }

    // R2-M-11: 既存カラム確認を個別に行い、ALTER 1 本ずつを直接実行する。
    // ALTER TABLE は SQLite では DDL として自動コミットされるため
    // BEGIN/COMMIT で囲んでもロールバックは効かない (旧実装の包みを撤去)。
    add_column_if_missing(
        conn,
        "mira_scheduled_events",
        "remind_minutes_before",
        "INTEGER NOT NULL DEFAULT 10",
    )?;
    add_column_if_missing(
        conn,
        "mira_scheduled_events",
        "reminded",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(conn, "mira_scheduled_events", "recurrence_kind", "TEXT")?;
    add_column_if_missing(conn, "mira_scheduled_events", "last_fired_at", "TEXT")?;

    // L2 R2-6: 旧 mira_settings には value_type 列が無いため、ADD COLUMN で
    // デフォルト 'text' を入れた上で、BOOL_SETTING_KEYS 相当のキーには 'bool' を upsert する。
    // CHECK 制約は付けない (将来 'json' / 'int' 等を追加する余地を残す)。
    add_column_if_missing(
        conn,
        "mira_settings",
        "value_type",
        "TEXT NOT NULL DEFAULT 'text'",
    )?;
    // 既存行の value_type を bool キーだけ 'bool' に矯正する (冪等)
    for key in &[
        "transition_enabled",
        "snapshot_enabled",
        "onboarding_completed",
        "voicevox_enabled",
        "reminder_sound_enabled",
    ] {
        conn.execute(
            "UPDATE mira_settings SET value_type = 'bool' WHERE key = ?1 AND value_type != 'bool'",
            [*key],
        )?;
    }

    // 性能向上のための明示 INDEX。SARGable な等価/範囲検索の頻出カラムに付与。
    // L2 R2-2: mira_manual_markers の date INDEX は (date, start_pos) 複合に強化し、
    //   load_manual_markers の `WHERE date=? ORDER BY start_pos` を 1 つの INDEX で賄う。
    //   旧 idx_mira_manual_markers_date は実害無しでも残すと PLAN 選択ノイズになるため DROP する。
    // L2 R2-4: mira_scheduled_events(title, scheduled_at) の UNIQUE INDEX は
    //   既存重複データを保持しつつ「新規登録時の衝突検出」だけを担う。
    //   再作成時 (次の major) には CREATE TABLE に UNIQUE(title, scheduled_at) を統合する。
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_mira_scheduled_events_scheduled_at
            ON mira_scheduled_events (scheduled_at);
        DROP INDEX IF EXISTS idx_mira_manual_markers_date;
        CREATE INDEX IF NOT EXISTS idx_mira_manual_markers_date
            ON mira_manual_markers (date, start_pos);
        CREATE INDEX IF NOT EXISTS idx_mira_dismissed_events_dismissed_at
            ON mira_dismissed_events (dismissed_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mira_scheduled_events_unique
            ON mira_scheduled_events (title, scheduled_at);
        ",
    )?;

    // 既知の設定キーにデフォルト値を投入する (既存値は INSERT OR IGNORE で温存)。
    // ここに無いキーは get_settings の `unwrap_or_default()` で空文字扱いになる。
    let defaults = [
        ("font_family", "Yomogi"),
        ("font_scope", "content_only"),
        ("memo_max_length", "1000"),
        ("transition_enabled", "1"),
        ("snapshot_enabled", "1"),
        ("last_snapshot_seen", ""),
        ("last_annual_seen", ""),
        ("onboarding_completed", "0"),
        ("view_hour_start", ""),
        ("view_hour_end", ""),
        ("voicevox_enabled", "0"),
        ("voice_character", "metan"),
        ("reminder_sound_enabled", "1"),
    ];

    for (key, value) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO mira_settings (key, value) VALUES (?1, ?2)",
            [key, value],
        )?;
    }

    // L5 SQL-Opt-3: INDEX / 列の統計情報を更新し、クエリプラン精度を上げる。
    //   `PRAGMA optimize` は SQLite 3.18+ で「必要に応じて」ANALYZE を走らせるため、
    //   毎起動時に呼んでも軽量 (3.42 では更に賢く skip される)。
    //   失敗しても起動を止めない (warn のみ)。
    if let Err(e) = conn.execute_batch("PRAGMA optimize;") {
        crate::utils::logging::log_warn("db", &format!("PRAGMA optimize 失敗 (継続): {e}"));
    }

    Ok(())
}

/// `pragma_table_info` で対象カラムの有無を確認し、未追加なら ALTER で追加する。
///
/// R2-M-11: 個別チェック + 個別 ALTER により部分適用リスクを避ける。
/// `ALTER TABLE` は `SQLite` では DDL として自動コミットされるため明示トランザクションは不要。
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_def: &str,
) -> Result<()> {
    // L2 R2-14: table / column は SQL に埋め込むため識別子検証する。
    // column_def は CHECK 句など記号を含み得るので、内部定数文字列前提でそのまま渡す。
    if !is_safe_identifier(table) || !is_safe_identifier(column) {
        return Ok(());
    }
    if column_exists(conn, table, column)? {
        return Ok(());
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {column_def};"
    ))?;
    Ok(())
}

/// `pragma_table_info` で対象カラムの存在を確認し、存在すれば DROP する。
///
/// `SQLite` 3.35+ (`rusqlite` 0.38 bundled ≥ 3.42) の `ALTER TABLE ... DROP COLUMN` を利用する。
fn drop_column_if_exists(conn: &Connection, table: &str, column: &str) -> Result<()> {
    if !is_safe_identifier(table) || !is_safe_identifier(column) {
        return Ok(());
    }
    if !column_exists(conn, table, column)? {
        return Ok(());
    }
    conn.execute_batch(&format!("ALTER TABLE {table} DROP COLUMN {column};"))?;
    Ok(())
}

/// 指定テーブルに対象カラムが存在するかを `pragma_table_info` で照会する。
///
/// クエリ自体は失敗しない前提 (失敗時は 0 件として「存在しない」扱い) のため `Result` 包みは
/// `add_column_if_missing` / `drop_column_if_exists` の `?` 結合用シグネチャ合わせ。
///
/// L2 R2-14: `pragma_table_info('{table}')` のテーブル名は SQL リテラルに埋め込むため、
/// 英数字・アンダースコアのみのホワイトリスト検証で SQL インジェクションを未然に防ぐ。
/// 現状の呼出元は内部マイグレーションの定数文字列のみで実害は無いが、将来動的な値が
/// 流れ込むケースに備えた防御策。
#[allow(clippy::unnecessary_wraps)]
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    if !is_safe_identifier(table) {
        return Ok(false);
    }
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
            [column],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(count > 0)
}

/// SQL 識別子 (テーブル名 / カラム名) として安全な文字列かを判定する。
///
/// 許可するのは英数字 + アンダースコアのみ。空文字列・先頭が数字のものも弾く。
fn is_safe_identifier(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut chars = s.chars();
    let first = chars.next().unwrap_or('\0');
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}
