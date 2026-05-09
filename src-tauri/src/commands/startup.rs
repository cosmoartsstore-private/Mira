use serde::Serialize;
use tauri::State;

use crate::db::DbState;

#[derive(Serialize)]
pub struct ScheduleNotification {
    pub title: String,
    pub scheduled_at: String,
    pub event_type: String,
}

#[derive(Serialize)]
pub struct StartupInfo {
    pub stella_connected: bool,
    pub pending_notifications: Vec<ScheduleNotification>,
    pub pending_review: Option<String>,
    pub onboarding_needed: bool,
}

#[tauri::command]
pub fn get_startup_info(state: State<'_, DbState>) -> Result<StartupInfo, String> {
    let stella_connected = state.stella.lock().unwrap().is_some();

    let mira = state.mira.lock().unwrap();

    let onboarding_needed = mira
        .query_row(
            "SELECT value FROM mira_settings WHERE key = 'onboarding_completed'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "0".to_string())
        == "0";

    // Check pending schedule notifications for today/upcoming
    let pending_notifications = get_pending_notifications(&mira);

    // Check if a review animation should trigger
    let pending_review = check_pending_review(&mira);

    Ok(StartupInfo {
        stella_connected,
        pending_notifications,
        pending_review,
        onboarding_needed,
    })
}

fn get_pending_notifications(
    conn: &rusqlite::Connection,
) -> Vec<ScheduleNotification> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let week_later = (chrono::Local::now() + chrono::Duration::days(7))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = conn
        .prepare(
            "SELECT title, scheduled_at, event_type FROM mira_scheduled_events
             WHERE notify_on_launch = 1
               AND date(scheduled_at) BETWEEN ?1 AND ?2
             ORDER BY scheduled_at",
        )
        .unwrap();

    stmt.query_map([&today, &week_later], |row| {
        Ok(ScheduleNotification {
            title: row.get(0)?,
            scheduled_at: row.get(1)?,
            event_type: row.get(2)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn check_pending_review(conn: &rusqlite::Connection) -> Option<String> {
    let now = chrono::Local::now();
    let year = now.format("%Y").to_string();
    let month = now.month();

    // Annual: January → show previous year's annual
    if month == 1 {
        let prev_year = (now.year() - 1).to_string();
        let last_seen: String = conn
            .query_row(
                "SELECT value FROM mira_settings WHERE key = 'last_annual_seen'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if last_seen != prev_year {
            return Some(format!("annual_{}", prev_year));
        }
    }

    // Snapshot: Q1 start=Apr, Q2 start=Jul, Q3 start=Oct
    let quarter_key = match month {
        4..=6 => Some(format!("{}-Q1", year)),
        7..=9 => Some(format!("{}-Q2", year)),
        10..=12 => Some(format!("{}-Q3", year)),
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
            return Some(format!("snapshot_{}", qk));
        }
    }

    None
}

use chrono::Datelike;
