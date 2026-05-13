use serde::Serialize;
use tauri::State;

use crate::db::DbState;

/// 指定月のカレンダー表示用データ
#[derive(Serialize)]
pub struct MonthData {
    pub year: u16,
    pub month: u8,
    pub active_days: Vec<u8>,
    pub events: Vec<CalendarEvent>,
}

/// カレンダーに表示する予定イベント
#[derive(Serialize, Clone)]
pub struct CalendarEvent {
    pub id: i64,
    pub title: String,
    pub scheduled_at: String,
    pub remind_minutes_before: i64,
}

/// 指定年月のアクティブ日 (STELLA の visit_summary に1件以上ある日) と Mira 側のユーザー予定を一括返却する。
/// STELLA 未接続 (Option None) ならアクティブ日を空配列で扱い、予定だけ返す。
#[tauri::command]
pub fn get_month_data(
    state: State<'_, DbState>,
    year: u16,
    month: u8,
) -> Result<MonthData, String> {
    let stella_guard = state.stella.lock().unwrap();
    let mira = state.mira.lock().unwrap();

    let date_prefix = format!("{:04}-{:02}", year, month);

    let active_days: Vec<u8> = match stella_guard.as_ref() {
        Some(stella) => {
            let mut stmt = stella
                .prepare(
                    "SELECT DISTINCT CAST(strftime('%d', join_time) AS INTEGER)
                     FROM visit_summary
                     WHERE strftime('%Y-%m', join_time) = ?1",
                )
                .map_err(|e| e.to_string())?;

            let days = stmt
                .query_map([&date_prefix], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            days
        }
        None => vec![],
    };

    let mut evt_stmt = mira
        .prepare(
            "SELECT id, title, scheduled_at, remind_minutes_before
             FROM mira_scheduled_events
             WHERE strftime('%Y-%m', scheduled_at) = ?1
             ORDER BY scheduled_at",
        )
        .map_err(|e| e.to_string())?;

    let events: Vec<CalendarEvent> = evt_stmt
        .query_map([&date_prefix], |row| {
            Ok(CalendarEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                scheduled_at: row.get(2)?,
                remind_minutes_before: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(MonthData {
        year,
        month,
        active_days,
        events,
    })
}

/// 予定イベントを 'reservation' 種別で追加する。
/// notify_on_launch=1 を必ず立てるため、追加直後に Mira を再起動すれば起動バナーに即出る。
/// reminded=0 で開始し、check_due_reminders が発火時刻に達したら 1 に更新する。
#[tauri::command]
pub fn add_event(
    state: State<'_, DbState>,
    title: String,
    scheduled_at: String,
    remind_minutes_before: i64,
) -> Result<i64, String> {
    let mira = state.mira.lock().unwrap();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    mira.execute(
        "INSERT INTO mira_scheduled_events (event_type, title, scheduled_at, source, notify_on_launch, remind_minutes_before, reminded, created_at)
         VALUES ('reservation', ?1, ?2, 'user', 1, ?3, 0, ?4)",
        rusqlite::params![title, scheduled_at, remind_minutes_before, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(mira.last_insert_rowid())
}

/// 指定 ID の予定イベントを物理削除する (履歴は残さない)
#[tauri::command]
pub fn remove_event(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let mira = state.mira.lock().unwrap();
    mira.execute("DELETE FROM mira_scheduled_events WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
