use serde::Serialize;
use tauri::State;

use crate::db::DbState;

/// リマインダー通知対象のイベント情報
#[derive(Serialize, Clone)]
pub struct ReminderEvent {
    pub id: i64,
    pub title: String,
    pub scheduled_at: String,
    pub event_type: String,
    pub minutes_until: i64,
}

/// 通知時刻に達した未通知リマインダーを取得し、通知済みに更新する
#[tauri::command]
pub fn check_due_reminders(state: State<'_, DbState>) -> Result<Vec<ReminderEvent>, String> {
    let mira = state.mira.lock().unwrap();
    let now_str = chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    let mut stmt = mira
        .prepare(
            "SELECT id, title, scheduled_at, event_type, remind_minutes_before
             FROM mira_scheduled_events
             WHERE reminded = 0
               AND datetime(scheduled_at, '-' || remind_minutes_before || ' minutes') <= ?1
               AND datetime(scheduled_at) >= ?1",
        )
        .map_err(|e| e.to_string())?;

    let reminders: Vec<ReminderEvent> = stmt
        .query_map([&now_str], |row| {
            Ok(ReminderEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                scheduled_at: row.get(2)?,
                event_type: row.get(3)?,
                minutes_until: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    // 取得したリマインダーを通知済みに更新
    for r in &reminders {
        let _ = mira.execute(
            "UPDATE mira_scheduled_events SET reminded = 1 WHERE id = ?1",
            [r.id],
        );
    }

    Ok(reminders)
}

