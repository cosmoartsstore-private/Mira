//! Mira DB のスキーマ DDL とマイグレーション処理。
//! `CREATE TABLE IF NOT EXISTS` 群と、`pragma_table_info` ベースで列の存在を確認してから
//! ALTER / DROP する防御的マイグレーション関数を提供する。

use rusqlite::{Connection, Result};

/// Mira DB を最新スキーマに揃える。
/// 1. `CREATE TABLE IF NOT EXISTS` で現行テーブル群を作る (初回起動時のみ実体作成)
/// 2. 廃止テーブル / 廃止カラムの整理 (`DROP IF EXISTS` パターンで冪等)
/// 3. 既存テーブルに後付けされたカラムを未追加なら `ALTER` で足す
/// 4. 性能向上のための `INDEX` を作成 (`IF NOT EXISTS` で冪等)
/// 5. `mira_settings` に既知の設定キーをデフォルト値で投入 (`INSERT OR IGNORE`)
///
/// 連番工程のため 1 関数に集約。スキーマ DDL リテラルが大半を占めるので
/// `too_many_lines` は許容する。
#[allow(clippy::too_many_lines)]
pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS mira_journal_entries (
            date              TEXT PRIMARY KEY,
            user_memo         TEXT,
            data_version      TEXT,
            created_at        DATETIME NOT NULL,
            updated_at        DATETIME NOT NULL
        );

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

        CREATE TABLE IF NOT EXISTS mira_manual_markers (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            date      TEXT NOT NULL,
            start_pos INTEGER NOT NULL,
            end_pos   INTEGER NOT NULL,
            color     TEXT NOT NULL DEFAULT 'red',
            CHECK (start_pos < end_pos)
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

    // 廃止テーブル / 廃止カラムの撤去 (DROP IF EXISTS で冪等)
    // R2-M-23: お気に入りユーザー機能は UI 配線が無く dead 判定されたため撤去 (2026-05-17)
    conn.execute_batch("DROP TABLE IF EXISTS mira_favorite_users;")?;
    // R2-M-24: 旧スキーマで予約だけされ実装されなかったカラムを撤去 (2026-05-17)
    drop_column_if_exists(conn, "mira_journal_entries", "template_id")?;
    drop_column_if_exists(conn, "mira_journal_entries", "generated_summary")?;
    drop_column_if_exists(conn, "mira_scheduled_events", "description")?;
    // R2-M-26: mira_world_colors の主キーを world_id → world_name に切替 (2026-05-17)
    // 旧スキーマで `world_id` 列を持っているなら一旦テーブルごと作り直す
    // (色は使い込めばまた生成されるためデータ移行は不要)
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

    // 性能向上のための明示 INDEX。SARGable な等価/範囲検索の頻出カラムに付与。
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_mira_scheduled_events_scheduled_at
            ON mira_scheduled_events (scheduled_at);
        CREATE INDEX IF NOT EXISTS idx_mira_manual_markers_date
            ON mira_manual_markers (date);
        CREATE INDEX IF NOT EXISTS idx_mira_dismissed_events_dismissed_at
            ON mira_dismissed_events (dismissed_at);
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
#[allow(clippy::unnecessary_wraps)]
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let count: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"),
            [column],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(count > 0)
}
