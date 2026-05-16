//! Mira DB のスキーマ DDL とマイグレーション処理。
//! `CREATE TABLE IF NOT EXISTS` 群と、`pragma_table_info` ベースで列の存在を確認してから
//! ALTER する防御的マイグレーション関数を提供する。

use rusqlite::{Connection, Result};

/// Mira DB を最新スキーマに揃える。
/// 1. CREATE TABLE IF NOT EXISTS で初期テーブル群を作る（初回起動時のみ実体作成）
/// 2. 後から追加した `remind_minutes_before` / reminded カラムを未追加なら ALTER で足す
/// 3. `mira_settings` に既知の設定キーをデフォルト値で投入 (INSERT OR IGNORE)
pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mira_journal_entries (
            date              TEXT PRIMARY KEY,
            generated_summary TEXT,
            user_memo         TEXT,
            template_id       TEXT,
            data_version      TEXT,
            created_at        DATETIME NOT NULL,
            updated_at        DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mira_scheduled_events (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type        TEXT NOT NULL,
            title             TEXT NOT NULL,
            scheduled_at      DATETIME NOT NULL,
            description       TEXT,
            source            TEXT NOT NULL,
            source_ref        TEXT,
            notify_on_launch  BOOLEAN NOT NULL DEFAULT 1,
            is_recurring      BOOLEAN NOT NULL DEFAULT 0,
            created_at        DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mira_favorite_users (
            user_id     TEXT PRIMARY KEY,
            nickname    TEXT,
            line_color  TEXT,
            note        TEXT,
            added_at    DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mira_world_colors (
            world_id    TEXT PRIMARY KEY,
            color_hex   TEXT NOT NULL,
            is_custom   BOOLEAN NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS mira_manual_markers (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            date     TEXT NOT NULL,
            start_pos INTEGER NOT NULL,
            end_pos  INTEGER NOT NULL,
            color    TEXT NOT NULL DEFAULT 'manual'
        );

        CREATE TABLE IF NOT EXISTS mira_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- source_ref: 現状は mira_scheduled_events.id を文字列化して格納 (将来 snapshot 等の他通知種別にも対応するための汎用カラム)
        CREATE TABLE IF NOT EXISTS mira_dismissed_events (
            source_ref   TEXT PRIMARY KEY,
            dismissed_at DATETIME NOT NULL
        );
        ",
    )?;

    // R2-M-11: 既存カラム確認を個別に行い、ALTER 1 本ずつをトランザクション内で実行する。
    // execute_batch で複数 ALTER を一括実行すると、片方追加済みのときに全体が失敗し
    // 「最初の ALTER だけ適用されて止まる」中途半端な状態を招くため。
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
    add_column_if_missing(
        conn,
        "mira_scheduled_events",
        "recurrence_kind",
        "TEXT",
    )?;
    add_column_if_missing(
        conn,
        "mira_scheduled_events",
        "last_fired_at",
        "TEXT",
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

    Ok(())
}

/// `pragma_table_info` で対象カラムの有無を確認し、未追加なら ALTER で追加する
///
/// R2-M-11: 個別チェック + 個別 ALTER により部分適用リスクを避ける。
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    column_def: &str,
) -> Result<()> {
    let count: i64 = conn
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"
            ),
            [column],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if count == 0 {
        // 単一 ALTER 文を 1 トランザクション内で実行する。失敗時はロールバックされ
        // pragma 状態を維持できる。
        conn.execute_batch(&format!(
            "BEGIN; ALTER TABLE {table} ADD COLUMN {column} {column_def}; COMMIT;"
        ))?;
    }

    Ok(())
}