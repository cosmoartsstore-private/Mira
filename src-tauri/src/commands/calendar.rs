//! カレンダー機能の `Tauri` コマンド群。月別アクティブ日一覧 + ユーザー予定 (`mira_scheduled_events`)
//! の CRUD を提供する。週次繰り返し (`recurrence_kind = "weekly"`) のみ対応。

use serde::Serialize;
use tauri::State;

use crate::commands::REMIND_MIN_MAX;
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

/// 指定年月のアクティブ日 (STELLA の `visit_summary` に1件以上ある日) と Mira 側のユーザー予定を一括返却する。
/// STELLA 未接続 (Option None) ならアクティブ日を空配列で扱い、予定だけ返す。
#[tauri::command]
pub fn get_month_data(
    state: State<'_, DbState>,
    year: u16,
    month: u8,
) -> Result<MonthData, String> {
    let stella_guard = crate::db::lock_stella(&state)?;
    let mira = crate::db::lock_mira(&state)?;

    let date_prefix = format!("{year:04}-{month:02}");

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
                .filter_map(std::result::Result::ok)
                .collect();
            days
        }
        None => vec![],
    };

    // scheduled_at は "YYYY-MM-DD HH:MM" など秒なし形式も許容したいため、
    // strftime ではなく substr で先頭 7 文字を比較する
    let mut evt_stmt = mira
        .prepare(
            "SELECT id, title, scheduled_at, remind_minutes_before
             FROM mira_scheduled_events
             WHERE substr(scheduled_at, 1, 7) = ?1
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
        .filter_map(std::result::Result::ok)
        .collect();

    Ok(MonthData {
        year,
        month,
        active_days,
        events,
    })
}

/// 新しい予定イベントを追加し、挿入されたIDを返す
///
/// 仕様メモ (R2-M-1):
///   週次繰り返し (`recurrence_kind="weekly`") は `scheduled_at` の曜日を 1 つだけ採用し、
///   毎週その曜日 + 時刻に発火する。複数曜日指定 (例: 月水金) は現状未対応で、
///   利用側は曜日ごとに別予定を登録する必要がある。
///   将来 `recurrence_weekdays` カラムを追加する場合は migrations と
///   startup.rs / reminder.rs の `next_weekly_within_week` / `next_fire_today` を
///   合わせて更新すること。
#[tauri::command]
pub fn add_event(
    state: State<'_, DbState>,
    title: String,
    scheduled_at: String,
    remind_minutes_before: i64,
    is_recurring: Option<bool>,
    recurrence_kind: Option<String>,
) -> Result<i64, String> {
    // scheduled_at を検証 (YYYY-MM-DD HH:MM[:SS] 形式を許容)
    if chrono::NaiveDateTime::parse_from_str(&scheduled_at, "%Y-%m-%d %H:%M:%S").is_err()
        && chrono::NaiveDateTime::parse_from_str(&scheduled_at, "%Y-%m-%d %H:%M").is_err()
    {
        return Err(format!("invalid scheduled_at format: {scheduled_at}"));
    }

    // remind_minutes_before は 0..=1440 に制限 (負値・極端値の混入を防止)
    if !(0..=REMIND_MIN_MAX).contains(&remind_minutes_before) {
        return Err(format!(
            "remind_minutes_before must be in 0..={REMIND_MIN_MAX}, got {remind_minutes_before}"
        ));
    }

    // recurrence_kind は現状 `weekly` のみサポート (R2-M-1 参照)。それ以外は明確に弾く
    // ことで将来の文字列ドリフトを防ぐ。
    let recurring_flag = is_recurring.unwrap_or(false);
    let kind = if recurring_flag {
        let value = recurrence_kind.unwrap_or_else(|| "weekly".to_string());
        if value != "weekly" {
            return Err(format!(
                "unsupported recurrence_kind: {value} (現状は \"weekly\" のみ対応)"
            ));
        }
        Some(value)
    } else {
        None
    };

    let mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let recurring_int: i64 = i64::from(recurring_flag);

    // 重複防止: 同じ (title, scheduled_at) の予定が既に存在すればエラー (UI 連打対策)
    let dup_count: i64 = mira
        .query_row(
            "SELECT COUNT(*) FROM mira_scheduled_events WHERE title = ?1 AND scheduled_at = ?2",
            rusqlite::params![title, scheduled_at],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if dup_count > 0 {
        return Err(format!(
            "同名同時刻の予定が既に登録されています: {title} @ {scheduled_at}"
        ));
    }

    mira.execute(
        "INSERT INTO mira_scheduled_events (event_type, title, scheduled_at, source, notify_on_launch, remind_minutes_before, reminded, is_recurring, recurrence_kind, created_at)
         VALUES ('reservation', ?1, ?2, 'user', 1, ?3, 0, ?4, ?5, ?6)",
        rusqlite::params![title, scheduled_at, remind_minutes_before, recurring_int, kind, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(mira.last_insert_rowid())
}

/// 指定 ID の予定イベントを物理削除する (履歴は残さない)
#[tauri::command]
pub fn remove_event(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    mira.execute("DELETE FROM mira_scheduled_events WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}