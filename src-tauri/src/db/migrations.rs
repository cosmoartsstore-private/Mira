use rusqlite::{Connection, Result};

/// MiraDBのテーブル作成・マイグレーション・デフォルト設定の投入を行う
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

        CREATE TABLE IF NOT EXISTS mira_dismissed_events (
            source_ref   TEXT PRIMARY KEY,
            dismissed_at DATETIME NOT NULL
        );
        ",
    )?;

    // remind_minutes_before カラムが未追加なら追加する
    let has_remind_col: bool = conn
        .prepare("SELECT COUNT(*) FROM pragma_table_info('mira_scheduled_events') WHERE name = 'remind_minutes_before'")
        .and_then(|mut s| s.query_row([], |r| r.get::<_, i32>(0)))
        .unwrap_or(0) > 0;

    if !has_remind_col {
        conn.execute_batch(
            "ALTER TABLE mira_scheduled_events ADD COLUMN remind_minutes_before INTEGER NOT NULL DEFAULT 10;
             ALTER TABLE mira_scheduled_events ADD COLUMN reminded INTEGER NOT NULL DEFAULT 0;"
        )?;
    }

    // デフォルト設定値を投入(既存キーはスキップ)
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
