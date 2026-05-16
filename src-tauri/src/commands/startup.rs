//! アプリ起動時の Tauri コマンド群。`StellaRecord` 接続状況・初回オンボーディング判定・
//! 起動時リマインダー候補の取得と dismiss 処理、スナップショットレビュー誘導を統括する。

use chrono::Datelike;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize, Clone)]
pub struct ScheduleNotification {
    pub id: i64,
    pub title: String,
    pub scheduled_at: String,
    pub event_type: String,
    /// dismiss 比較用の安定キー。
    /// 非繰り返しは "<id>"、週次は "<id>_YYYY-MM-DD" (発火予定日)。
    pub source_ref: String,
}

/// アプリ起動直後にフロントへ一括で返す初期状態
#[derive(Serialize)]
pub struct StartupInfo {
    pub stella_connected: bool,
    pub pending_notifications: Vec<ScheduleNotification>,
    /// 振り返り演出のトリガキー (例: "`annual_2025`", "snapshot_2026-Q1")。なければ None。
    pub pending_review: Option<String>,
    pub onboarding_needed: bool,
}

/// フロントが initApp 直後に呼ぶエントリ。STELLA 接続・予定・レビュー誘導・初回判定をまとめて返す。
#[tauri::command]
pub fn get_startup_info(state: State<'_, DbState>) -> Result<StartupInfo, String> {
    let stella_connected = crate::db::lock_stella(&state)?.is_some();

    let mira = crate::db::lock_mira(&state)?;

    // mira_settings の文字列値を取得する小ヘルパー (キー未設定時は空文字)
    let get_setting = |key: &str| -> String {
        mira.query_row(
            "SELECT value FROM mira_settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_default()
    };

    // onboarding_completed が "0" (デフォルト) のままなら初回起動とみなす
    let onboarding_needed = get_setting("onboarding_completed") != "1";
    // 設定 snapshot_enabled が OFF ならスナップショット/年間レビューも抑制する
    let snapshot_enabled = get_setting("snapshot_enabled") == "1";

    // 古い dismiss レコードをGC (30日経過分)
    let _ = mira.execute(
        "DELETE FROM mira_dismissed_events WHERE dismissed_at < date('now','-30 days')",
        [],
    );

    // 今日・今後の予定通知候補を取得
    let pending_notifications = query_pending_notifications(&mira);

    // 期 (Q1〜Q3) または年明け (annual) の振り返り未表示判定
    let pending_review = if onboarding_needed || !snapshot_enabled {
        // onboarding 中 or 設定で無効化中: 抑制 (last_seen は更新しないので有効化時に再候補化される)
        None
    } else {
        check_pending_review(&mira)
    };

    Ok(StartupInfo {
        stella_connected,
        pending_notifications,
        pending_review,
        onboarding_needed,
    })
}

/// 起動時/予定変更時に表示する pending 通知を再取得する
#[tauri::command]
pub fn get_pending_notifications(state: State<'_, DbState>) -> Result<Vec<ScheduleNotification>, String> {
    let mira = crate::db::lock_mira(&state)?;
    Ok(query_pending_notifications(&mira))
}

/// 起動通知を恒久的に dismiss する
///
/// `source_ref` は `ScheduleNotification.source_ref` をそのまま受け取り、
/// 非繰り返し予定は "<id>"、週次予定は "<id>_YYYY-MM-DD" となる。
#[tauri::command]
pub fn dismiss_notification(state: State<'_, DbState>, source_ref: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    mira.execute(
        "INSERT OR REPLACE INTO mira_dismissed_events (source_ref, dismissed_at) VALUES (?1, ?2)",
        rusqlite::params![source_ref, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 起動通知レビューを既読としてマークする (snapshot_* / annual_* キー)
#[tauri::command]
pub fn mark_review_seen(state: State<'_, DbState>, key: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    // key 例: "snapshot_2025-Q1" / "annual_2024"
    if let Some(rest) = key.strip_prefix("snapshot_") {
        mira.execute(
            "INSERT OR REPLACE INTO mira_settings (key, value) VALUES ('last_snapshot_seen', ?1)",
            [rest],
        )
        .map_err(|e| e.to_string())?;
    } else if let Some(rest) = key.strip_prefix("annual_") {
        mira.execute(
            "INSERT OR REPLACE INTO mira_settings (key, value) VALUES ('last_annual_seen', ?1)",
            [rest],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn query_pending_notifications(
    conn: &rusqlite::Connection,
) -> Vec<ScheduleNotification> {
    let now = chrono::Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    let week_later = (now + chrono::Duration::days(7))
        .format("%Y-%m-%d")
        .to_string();

    let mut result = Vec::new();

    // 1) 通常の予定 (非繰り返し): source_ref = "<id>"
    //    reminded=0 のものだけを対象とし、既に発火済みの予定は除外する
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, scheduled_at, event_type FROM mira_scheduled_events
         WHERE notify_on_launch = 1
           AND COALESCE(is_recurring, 0) = 0
           AND COALESCE(reminded, 0) = 0
           AND date(scheduled_at) BETWEEN ?1 AND ?2
           AND CAST(id AS TEXT) NOT IN (SELECT source_ref FROM mira_dismissed_events)
         ORDER BY scheduled_at",
    ) {
        if let Ok(iter) = stmt.query_map([&today, &week_later], |row| {
            let id: i64 = row.get(0)?;
            Ok(ScheduleNotification {
                id,
                title: row.get(1)?,
                scheduled_at: row.get(2)?,
                event_type: row.get(3)?,
                source_ref: id.to_string(),
            })
        }) {
            result.extend(iter.filter_map(std::result::Result::ok));
        }
    }

    // 2) 週次繰り返し予定: source_ref = "<id>_YYYY-MM-DD" (次回発火日)
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, scheduled_at, event_type FROM mira_scheduled_events
         WHERE notify_on_launch = 1
           AND COALESCE(is_recurring, 0) = 1
           AND COALESCE(recurrence_kind, '') = 'weekly'",
    ) {
        // dismiss 済 source_ref を一度に取得して照合する
        let dismissed: std::collections::HashSet<String> = conn
            .prepare("SELECT source_ref FROM mira_dismissed_events")
            .and_then(|mut s| {
                s.query_map([], |row| row.get::<_, String>(0))
                    .map(|it| it.filter_map(std::result::Result::ok).collect())
            })
            .unwrap_or_default();

        if let Ok(iter) = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        }) {
            for (id, title, scheduled_at, event_type) in iter.filter_map(std::result::Result::ok) {
                if let Some(next) = next_weekly_within_week(&scheduled_at, &now) {
                    let next_date = next.format("%Y-%m-%d").to_string();
                    let source_ref = format!("{id}_{next_date}");
                    if dismissed.contains(&source_ref) {
                        continue;
                    }
                    result.push(ScheduleNotification {
                        id,
                        title,
                        scheduled_at: next.format("%Y-%m-%d %H:%M:%S").to_string(),
                        event_type,
                        source_ref,
                    });
                }
            }
        }
    }

    result.sort_by(|a, b| a.scheduled_at.cmp(&b.scheduled_at));
    result
}

/// `scheduled_at` の曜日/時刻を基点に、今から 7 日以内の次の発火日時を返す
///
/// `scheduled_at` が未来日 (まだ初回発火していない) の場合は、未来の `base_date` 自身が
/// 最初の発火日となるのが正しく、今週内に同曜日があっても発火させない。
fn next_weekly_within_week(
    scheduled_at: &str,
    now: &chrono::DateTime<chrono::Local>,
) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::TimeZone;
    let date_part = scheduled_at.split([' ', 'T']).next()?;
    let time_part = scheduled_at.split([' ', 'T']).nth(1)?;

    let base_date = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?;
    let parts: Vec<&str> = time_part.split(':').collect();
    let h: u32 = parts.first()?.parse().ok()?;
    let m: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let s: u32 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);

    let today = now.date_naive();
    // base_date が未来日なら、まだ「初回」が来ていないので今週内の同曜日に前倒し発火させない
    if base_date > today {
        return None;
    }

    // base の曜日を現在以降最初の同曜日として見つける
    let target_weekday = base_date.weekday();
    for offset in 0..7i64 {
        let cand = today + chrono::Duration::days(offset);
        if cand.weekday() != target_weekday {
            continue;
        }
        let naive = cand.and_hms_opt(h, m, s)?;
        let dt = chrono::Local.from_local_datetime(&naive).single()?;
        // 同じ日で時刻が過ぎている場合は今週未来 (今日以降) に限って採用しない、
        // ただし "1時間以内の過去" は取りこぼし救済として含める
        if (dt - *now).num_minutes() >= -60 {
            return Some(dt);
        }
    }
    None
}

/// 振り返り演出 (snapshot / annual) を出すべきかを判定し、トリガキーを返す。
/// 各キーは表示後に `last_snapshot_seen` / `last_annual_seen` を更新する想定で、
/// 同じ期のキーが一致する間は再表示されない。
///
/// - 1 月のみ前年の annual を出す候補
/// - 4-6 月: 前期 (Q1=1-3月) のサマリー、7-9 月: Q2、10-12 月: Q3
/// - 1-3 月の snapshot は前年 Q4 だが現状未対応なので None
fn check_pending_review(conn: &rusqlite::Connection) -> Option<String> {
    let now = chrono::Local::now();
    let month = now.month();
    let current_year = now.year();

    // 1 月だけは前年 annual を未読なら出す
    if month == 1 {
        let prev_year = (current_year - 1).to_string();
        let last_seen: String = conn
            .query_row(
                "SELECT value FROM mira_settings WHERE key = 'last_annual_seen'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if last_seen != prev_year {
            return Some(format!("annual_{prev_year}"));
        }
    }

    // Snapshot: Q1 start=Apr, Q2 start=Jul, Q3 start=Oct, Q4 start=Jan (前年のQ4扱い)
    let quarter_key = match month {
        1..=3 => Some(format!("{}-Q4", current_year - 1)),
        4..=6 => Some(format!("{current_year}-Q1")),
        7..=9 => Some(format!("{current_year}-Q2")),
        10..=12 => Some(format!("{current_year}-Q3")),
        _ => None,
    };

    if let Some(qk) = quarter_key {
        let last_seen: String = conn
            .query_row(
                "SELECT value FROM mira_settings WHERE key = 'last_snapshot_seen'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if last_seen != qk {
            return Some(format!("snapshot_{qk}"));
        }
    }

    None
}
