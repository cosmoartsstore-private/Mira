//! フロントエンドから 30 秒間隔で呼ばれるリマインダーポーリングコマンド。
//! `mira_scheduled_events` から発火時刻を迎えた予定を抽出し、通知済みフラグ (`reminded` /
//! `last_fired_at`) を立てて結果を返す。週次繰り返しと dismiss 履歴も考慮する。

use chrono::Datelike;
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
///
/// 取得対象:
///   1. 予定時刻が現在以降で `remind_minutes_before` 範囲に入ったもの
///   2. 予定時刻が過去 1 時間以内で reminded=0 のもの (取りこぼし救済)
///   3. 週次繰り返し予定 (`is_recurring=1`, `recurrence_kind`='weekly') で
///      今日の該当曜日/時刻に `remind_minutes_before` 範囲に入り、
///      `last_fired_at` が今日以前のもの
///
/// 起動通知で dismiss された予定 (`mira_dismissed_events` に `source_ref` 一致) は除外する。
#[tauri::command]
pub fn check_due_reminders(state: State<'_, DbState>) -> Result<Vec<ReminderEvent>, String> {
    let mut mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let today_str = now.format("%Y-%m-%d").to_string();

    // `transaction()` は `&mut self` 必須で借用検査が効くため、後続の prepare/query_map
    // との二重トランザクション混入を機械的に弾ける (`unchecked_transaction()` 不採用)。
    let tx = mira
        .transaction()
        .map_err(|e| e.to_string())?;

    // dismiss 済 source_ref を一度に取得
    let dismissed: std::collections::HashSet<String> = tx
        .prepare("SELECT source_ref FROM mira_dismissed_events")
        .and_then(|mut s| {
            s.query_map([], |row| row.get::<_, String>(0))
                .map(|it| it.filter_map(std::result::Result::ok).collect())
        })
        .unwrap_or_default();

    // 通常の予定 (非繰り返し)
    // stmt と query_map の戻り値 (MappedRows) は借用関係にあるため、必ず別 let に束縛し
    // ブロック式の末尾でドロップ順を明示する。
    let mut stmt = tx
        .prepare(
            "SELECT id, title, scheduled_at, event_type,
                    CAST((julianday(scheduled_at) - julianday(?1)) * 1440 AS INTEGER) AS minutes_until
             FROM mira_scheduled_events
             WHERE reminded = 0
               AND COALESCE(is_recurring, 0) = 0
               AND (
                    (datetime(scheduled_at, '-' || remind_minutes_before || ' minutes') <= ?1
                     AND datetime(scheduled_at) >= ?1)
                 OR (datetime(scheduled_at) < ?1
                     AND datetime(scheduled_at) >= datetime(?1, '-1 hour'))
               )",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&now_str], |row| {
            Ok(ReminderEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                scheduled_at: row.get(2)?,
                event_type: row.get(3)?,
                minutes_until: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let candidates: Vec<ReminderEvent> = rows.filter_map(std::result::Result::ok).collect();
    drop(stmt);

    // 取得したリマインダーを通知済みに更新。UPDATE が失敗したものは結果から除外する
    let mut reminders: Vec<ReminderEvent> = Vec::with_capacity(candidates.len());
    for r in candidates {
        // 起動通知で dismiss 済の予定はスキップ
        if dismissed.contains(&r.id.to_string()) {
            // dismiss されていても reminded フラグは立てておく (再採用防止)
            let _ = tx.execute(
                "UPDATE mira_scheduled_events SET reminded = 1 WHERE id = ?1 AND reminded = 0",
                [r.id],
            );
            continue;
        }
        let updated = tx
            .execute(
                "UPDATE mira_scheduled_events SET reminded = 1 WHERE id = ?1 AND reminded = 0",
                [r.id],
            )
            .map_err(|e| e.to_string())?;
        if updated > 0 {
            reminders.push(r);
        }
    }

    // 週次繰り返し予定: 今日の同じ曜日/時刻に達したものを last_fired_at で重複防止しつつ採用
    let recurring = collect_recurring_due(&tx, &now, &today_str);
    let mut accepted_recurring: Vec<ReminderEvent> = Vec::with_capacity(recurring.len());
    for r in recurring {
        // 週次の dismiss キーは "<id>_YYYY-MM-DD"
        let source_ref = format!("{}_{}", r.id, today_str);
        if dismissed.contains(&source_ref) {
            continue;
        }
        let updated = tx
            .execute(
                "UPDATE mira_scheduled_events
                 SET last_fired_at = ?1
                 WHERE id = ?2 AND (last_fired_at IS NULL OR last_fired_at != ?1)",
                rusqlite::params![today_str, r.id],
            )
            .map_err(|e| e.to_string())?;
        if updated > 0 {
            accepted_recurring.push(r);
        }
    }
    reminders.extend(accepted_recurring);

    tx.commit().map_err(|e| e.to_string())?;

    Ok(reminders)
}

/// 週次繰り返しの予定から、今日すでに発火期間に入ったものを返す
///
/// `scheduled_at` の時刻部分を「今日の同じ時刻」に挮り替え、
/// その時刻が (`remind_minutes_before` 前 〜 1時間後) に入り、
/// `last_fired_at` != today であれば採用する。
fn collect_recurring_due(
    mira: &rusqlite::Connection,
    now: &chrono::DateTime<chrono::Local>,
    today_str: &str,
) -> Vec<ReminderEvent> {
    let Ok(mut stmt) = mira.prepare(
        "SELECT id, title, scheduled_at, event_type, remind_minutes_before, COALESCE(last_fired_at, '')
         FROM mira_scheduled_events
         WHERE COALESCE(is_recurring, 0) = 1
           AND COALESCE(recurrence_kind, '') = 'weekly'",
    ) else {
        return Vec::new();
    };

    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
        ))
    }) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for r in rows.filter_map(std::result::Result::ok) {
        let (id, title, scheduled_at, event_type, remind_min, last_fired) = r;
        // last_fired_at は "YYYY-MM-DD" を格納している (今日と一致したら今日は発火済み)
        if last_fired == today_str {
            continue;
        }
        // scheduled_at の曜日/時刻を今週の同じ曜日にマッピングし、今日発火したいかチェック
        let Some(target) = next_fire_today(&scheduled_at, now) else {
            continue;
        };
        let diff_min = (target - *now).num_minutes();
        // 今日の取りこぼしも採用 (remind_min 前 〜 1時間後)
        if diff_min <= remind_min && diff_min >= -60 {
            result.push(ReminderEvent {
                id,
                title,
                scheduled_at: target.format("%Y-%m-%d %H:%M:%S").to_string(),
                event_type,
                minutes_until: diff_min,
            });
        }
    }
    result
}

/// `scheduled_at` の時刻部分を、今日のその時刻にマッピングした日時を返す
///
/// `scheduled_at` の日付部分から曜日を抽出し、今日の曜日と一致しない場合は
/// 週次予定が「別の曜日」のものなので None を返す。
fn next_fire_today(
    scheduled_at: &str,
    now: &chrono::DateTime<chrono::Local>,
) -> Option<chrono::DateTime<chrono::Local>> {
    use chrono::TimeZone;
    // scheduled_at は "YYYY-MM-DD HH:MM:SS" または ISO 形式を想定
    let date_part = scheduled_at.split([' ', 'T']).next()?;
    let time_part = scheduled_at.split([' ', 'T']).nth(1)?;

    // scheduled_at の曜日を取得し、今日の曜日と異なれば発火対象外
    let base_date = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?;
    if base_date.weekday() != now.weekday() {
        return None;
    }
    // base_date がまだ未来 (初回発火日が今日より先) なら、たとえ今日が同曜日でも発火しない
    if base_date > now.date_naive() {
        return None;
    }

    let parts: Vec<&str> = time_part.split(':').collect();
    let h: u32 = parts.first()?.parse().ok()?;
    let m: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let s: u32 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
    let date = now.date_naive();
    let naive = date.and_hms_opt(h, m, s)?;
    chrono::Local.from_local_datetime(&naive).single()
}