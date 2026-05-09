use chrono::Datelike;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::logic::{marker, memokitto, world_color};

/// ワールド訪問ブロック（タイムライン表示用）
#[derive(Serialize, Clone)]
pub struct VisitBlock {
    pub world_id: String,
    pub world_name: String,
    pub color_hex: String,
    pub start_hour: f32,
    pub end_hour: f32,
    pub duration_min: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub players: Option<Vec<String>>,
}

/// 1日分のレーンデータ（週表示用）
#[derive(Serialize)]
pub struct DayLane {
    pub date: String,
    pub weekday: String,
    pub visits: Vec<VisitBlock>,
    pub has_activity: bool,
}

/// 週間レーン表示に必要なデータ一式
#[derive(Serialize)]
pub struct WeekLaneData {
    pub lanes: Vec<DayLane>,
    pub hour_start: u8,
    pub hour_end: u8,
}

/// 同席ユーザーのチップ表示用データ
#[derive(Serialize)]
pub struct PersonChip {
    pub user_id: String,
    pub display_name: String,
    pub is_favorite: bool,
    pub co_visit_count: u32,
}

/// メモ内の自動検出マーカー範囲
#[derive(Serialize)]
pub struct MarkerSpan {
    pub start: usize,
    pub end: usize,
    pub kind: String,
    pub text: String,
}

/// スクリーンショットのエントリ
#[derive(Serialize, Clone)]
pub struct PhotoEntry {
    pub file_path: String,
    pub hour: f32,
}

/// ユーザーが手動で付けたマーカー
#[derive(Serialize, Clone)]
pub struct ManualMarker {
    pub id: i64,
    pub start: usize,
    pub end: usize,
    pub color: String,
}

/// 日別フォーカス画面の全データ
#[derive(Serialize)]
pub struct DayFocusData {
    pub date: String,
    pub date_label: String,
    pub visits: Vec<VisitBlock>,
    pub total_duration_min: u32,
    pub people_count: u32,
    pub photos: Vec<PhotoEntry>,
    pub photo_count: u32,
    pub memo: Option<String>,
    pub memo_markers: Vec<MarkerSpan>,
    pub manual_markers: Vec<ManualMarker>,
    pub memokitto: Vec<memokitto::MemokittoChip>,
    pub has_update: bool,
}

/// 指定週の7日分レーンデータを取得する
#[tauri::command]
pub fn get_week_lane_data(
    state: State<'_, DbState>,
    week_start: String,
) -> Result<WeekLaneData, String> {
    let stella_guard = state.stella.lock().unwrap();
    let mira = state.mira.lock().unwrap();

    let stella = stella_guard
        .as_ref()
        .ok_or_else(|| "STELLARecord not connected".to_string())?;

    let start_date =
        chrono::NaiveDate::parse_from_str(&week_start, "%Y-%m-%d").map_err(|e| e.to_string())?;

    let (default_start, default_end) = crate::logic::time_range::detect_activity_range(stella);
    let hour_start = get_setting_u8(&mira, "view_hour_start").unwrap_or(default_start);
    let hour_end = get_setting_u8(&mira, "view_hour_end").unwrap_or(default_end);

    let lanes = (0..7)
        .map(|i| {
            let date = start_date + chrono::Duration::days(i);
            let date_str = date.format("%Y-%m-%d").to_string();
            let weekday = format_weekday(date.weekday());
            let visits = query_visits_for_date(stella, &mira, &date_str)?;
            let has_activity = !visits.is_empty();
            Ok(DayLane {
                date: date_str,
                weekday,
                visits,
                has_activity,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(WeekLaneData {
        lanes,
        hour_start,
        hour_end,
    })
}

/// 指定日のフォーカス画面データ（訪問・人・写真・メモ等）を取得する
#[tauri::command]
pub fn get_day_focus_data(state: State<'_, DbState>, date: String) -> Result<DayFocusData, String> {
    let stella_guard = state.stella.lock().unwrap();
    let mira = state.mira.lock().unwrap();

    let stella = stella_guard
        .as_ref()
        .ok_or_else(|| "STELLARecord not connected".to_string())?;

    let mut visits = query_visits_for_date(stella, &mira, &date)?;
    let total_duration_min: u32 = visits.iter().map(|v| v.duration_min).sum();

    attach_players_to_visits(stella, &date, &mut visits);

    let people = query_people_for_date(stella, &mira, &date)?;
    let people_count = people.len() as u32;

    let photos = query_photos_for_date(stella, &date)?;
    let photo_count = photos.len() as u32;

    let memo = mira
        .query_row(
            "SELECT user_memo FROM mira_journal_entries WHERE date = ?1",
            [&date],
            |row| row.get::<_, Option<String>>(0),
        )
        .unwrap_or(None);

    let world_names: Vec<String> = visits.iter().map(|v| v.world_name.clone()).collect();
    let people_names: Vec<String> = people.iter().map(|p| p.display_name.clone()).collect();

    let memo_markers = memo
        .as_deref()
        .map(|memo_text| {
            marker::find_markers(memo_text, &world_names, &people_names)
                .into_iter()
                .map(|m| MarkerSpan {
                    start: m.start,
                    end: m.end,
                    kind: match m.kind {
                        marker::MarkerKind::World => "world".to_string(),
                        marker::MarkerKind::Person => "person".to_string(),
                    },
                    text: m.text,
                })
                .collect()
        })
        .unwrap_or_default();

    let memokitto_chips = memokitto::extract(&date, stella);
    let manual_markers = load_manual_markers(&mira, &date);

    let parsed_date =
        chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| e.to_string())?;
    let date_label = format!(
        "{}年{}月{}日 {}",
        parsed_date.year(),
        parsed_date.month(),
        parsed_date.day(),
        format_weekday_jp(parsed_date.weekday())
    );

    Ok(DayFocusData {
        date,
        date_label,
        visits,
        total_duration_min,
        people_count,
        photos,
        photo_count,
        memo,
        memo_markers,
        manual_markers,
        memokitto: memokitto_chips,
        has_update: false,
    })
}

/// 指定日のメモを保存（UPSERT）する
#[tauri::command]
pub fn save_day_memo(state: State<'_, DbState>, date: String, memo: String) -> Result<(), String> {
    let mira = state.mira.lock().unwrap();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 1000文字以内に制限
    let max_len = memo.char_indices().nth(1000).map_or(memo.len(), |(i, _)| i);
    let trimmed = &memo[..max_len];

    mira.execute(
        "INSERT INTO mira_journal_entries (date, user_memo, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(date) DO UPDATE SET user_memo = ?2, updated_at = ?3",
        rusqlite::params![date, trimmed, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 手動マーカーを追加し、挿入されたIDを返す
#[tauri::command]
pub fn add_manual_marker(
    state: State<'_, DbState>,
    date: String,
    start: usize,
    end: usize,
    color: String,
) -> Result<i64, String> {
    let mira = state.mira.lock().unwrap();
    mira.execute(
        "INSERT INTO mira_manual_markers (date, start_pos, end_pos, color) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![date, start as i64, end as i64, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(mira.last_insert_rowid())
}

/// 指定IDの手動マーカーを削除する
#[tauri::command]
pub fn remove_manual_marker(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let mira = state.mira.lock().unwrap();
    mira.execute("DELETE FROM mira_manual_markers WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 指定日の手動マーカー一覧をDBから読み込む
fn load_manual_markers(mira: &rusqlite::Connection, date: &str) -> Vec<ManualMarker> {
    let Ok(mut stmt) = mira.prepare(
        "SELECT id, start_pos, end_pos, color FROM mira_manual_markers WHERE date = ?1 ORDER BY start_pos",
    ) else {
        return Vec::new();
    };

    stmt.query_map([date], |row| {
        Ok(ManualMarker {
            id: row.get(0)?,
            start: row.get::<_, i64>(1)? as usize,
            end: row.get::<_, i64>(2)? as usize,
            color: row.get(3)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

// 指定日のワールド訪問一覧をSTELLAから取得する
fn query_visits_for_date(
    stella: &rusqlite::Connection,
    mira: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<VisitBlock>, String> {
    let mut stmt = stella
        .prepare(
            "SELECT world_id, world_name, join_time, leave_time, duration_sec
             FROM visit_summary
             WHERE date(join_time) = ?1
             ORDER BY join_time",
        )
        .map_err(|e| e.to_string())?;

    let visits = stmt
        .query_map([date], |row| {
            let world_id: String = row.get(0)?;
            let world_name: String = row.get(1)?;
            let join_time: String = row.get(2)?;
            let leave_time: Option<String> = row.get(3)?;
            let duration_sec: u32 = row.get::<_, Option<u32>>(4)?.unwrap_or(0);

            let start_hour = parse_hour_fraction(&join_time);
            let end_hour = leave_time
                .as_deref()
                .map(parse_hour_fraction)
                .unwrap_or_else(|| start_hour + (duration_sec as f32 / 3600.0));

            Ok((world_id, world_name, start_hour, end_hour, duration_sec / 60))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(world_id, world_name, start_hour, end_hour, duration_min)| {
            let color_hex = get_or_generate_world_color(mira, &world_id, &world_name);
            VisitBlock {
                world_id,
                world_name,
                color_hex,
                start_hour,
                end_hour,
                duration_min,
                players: None,
            }
        })
        .collect();

    Ok(visits)
}

// 指定日の同席ユーザー一覧をSTELLAから取得する
fn query_people_for_date(
    stella: &rusqlite::Connection,
    mira: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<PersonChip>, String> {
    let mut stmt = stella
        .prepare(
            "SELECT fu.vrchat_id, fu.account_name, COUNT(DISTINCT wu.visit_id) AS co_visit_count
             FROM with_users wu
             JOIN find_users fu ON fu.vrchat_id = wu.vrchat_id
             JOIN visits v ON v.id = wu.visit_id
             WHERE wu.is_self = 0 AND date(v.join_time) = ?1
             GROUP BY fu.vrchat_id
             ORDER BY co_visit_count DESC",
        )
        .map_err(|e| e.to_string())?;

    let people = stmt
        .query_map([date], |row| {
            let user_id: String = row.get(0)?;
            let display_name: String = row.get(1)?;
            let co_visit_count: u32 = row.get(2)?;
            Ok((user_id, display_name, co_visit_count))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(user_id, display_name, co_visit_count)| {
            let is_favorite = mira
                .query_row(
                    "SELECT 1 FROM mira_favorite_users WHERE user_id = ?1",
                    [&user_id],
                    |_| Ok(()),
                )
                .is_ok();

            PersonChip {
                user_id,
                display_name,
                is_favorite,
                co_visit_count,
            }
        })
        .collect();

    Ok(people)
}

// 指定日のスクリーンショット一覧をSTELLAから取得する
fn query_photos_for_date(
    stella: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<PhotoEntry>, String> {
    let mut stmt = stella
        .prepare(
            "SELECT file_path, timestamp FROM screenshots
             WHERE date(timestamp) = ?1
             ORDER BY timestamp",
        )
        .map_err(|e| e.to_string())?;

    let photos = stmt
        .query_map([date], |row| {
            let file_path: String = row.get(0)?;
            let ts: String = row.get(1)?;
            let hour = parse_hour_fraction(&ts);
            Ok(PhotoEntry { file_path, hour })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(photos)
}

// 各訪問ブロックに同席プレイヤー名を紐付ける
fn attach_players_to_visits(
    stella: &rusqlite::Connection,
    date: &str,
    visits: &mut [VisitBlock],
) {
    let Ok(mut stmt) = stella.prepare(
        "SELECT v.join_time, fu.account_name
         FROM with_users wu
         JOIN find_users fu ON fu.vrchat_id = wu.vrchat_id
         JOIN visits v ON v.id = wu.visit_id
         WHERE wu.is_self = 0 AND date(v.join_time) = ?1
         ORDER BY v.join_time, fu.account_name",
    ) else {
        return;
    };

    let Ok(rows) = stmt.query_map([date], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) else {
        return;
    };

    let entries: Vec<(f32, String)> = rows
        .filter_map(|r| r.ok())
        .map(|(join_time, name)| (parse_hour_fraction(&join_time), name))
        .collect();

    for visit in visits.iter_mut() {
        let players: Vec<String> = entries
            .iter()
            .filter(|(h, _)| *h >= visit.start_hour && *h < visit.end_hour)
            .map(|(_, name)| name.clone())
            .collect();
        visit.players = if players.is_empty() { None } else { Some(players) };
    }
}

// ワールドIDに対応する色を取得し、なければ生成して保存する
fn get_or_generate_world_color(
    mira: &rusqlite::Connection,
    world_id: &str,
    world_name: &str,
) -> String {
    if let Ok(color) = mira.query_row(
        "SELECT color_hex FROM mira_world_colors WHERE world_id = ?1",
        [world_id],
        |row| row.get::<_, String>(0),
    ) {
        return color;
    }

    let color = world_color::generate_color(world_name);
    let _ = mira.execute(
        "INSERT OR IGNORE INTO mira_world_colors (world_id, color_hex, is_custom) VALUES (?1, ?2, 0)",
        rusqlite::params![world_id, &color],
    );

    color
}

// 設定テーブルからu8値を取得する（0は無効値として扱う）
fn get_setting_u8(conn: &rusqlite::Connection, key: &str) -> Option<u8> {
    conn.query_row(
        "SELECT value FROM mira_settings WHERE key = ?1",
        [key],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .and_then(|v| v.parse().ok())
    .filter(|v: &u8| *v > 0)
}

// 日時文字列から時刻を小数時間（例: 14:30 -> 14.5）に変換する
fn parse_hour_fraction(datetime_str: &str) -> f32 {
    let time_part = datetime_str
        .split([' ', 'T'])
        .nth(1)
        .unwrap_or("00:00:00");
    let parts: Vec<&str> = time_part.split(':').collect();
    let h: f32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let m: f32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    h + m / 60.0
}

// 曜日を英語略称に変換する
fn format_weekday(wd: chrono::Weekday) -> String {
    match wd {
        chrono::Weekday::Mon => "Mon",
        chrono::Weekday::Tue => "Tue",
        chrono::Weekday::Wed => "Wed",
        chrono::Weekday::Thu => "Thu",
        chrono::Weekday::Fri => "Fri",
        chrono::Weekday::Sat => "Sat",
        chrono::Weekday::Sun => "Sun",
    }
    .to_string()
}

// 曜日を日本語表記に変換する
fn format_weekday_jp(wd: chrono::Weekday) -> String {
    match wd {
        chrono::Weekday::Mon => "月曜日",
        chrono::Weekday::Tue => "火曜日",
        chrono::Weekday::Wed => "水曜日",
        chrono::Weekday::Thu => "木曜日",
        chrono::Weekday::Fri => "金曜日",
        chrono::Weekday::Sat => "土曜日",
        chrono::Weekday::Sun => "日曜日",
    }
    .to_string()
}
