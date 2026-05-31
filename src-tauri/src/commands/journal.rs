//! 日次ジャーナル機能の `Tauri` コマンド群。週レーンの可視化・日別フォーカス表示・メモ保存・
//! 手動マーカー編集を提供する。
//!
//! 1 日分の集計値 (人数・写真数・経過秒) を u32/f32 に変換する箇所が多数あるが、
//! いずれも 1 日分の活動量という現実的上限内 (~10^3 規模) なので
//! `truncation` / `precision_loss` は許容する (`#![allow(clippy::cast_*)]` を参照)。
//! マーカーの byte 位置を i64 として DB に格納する箇所も 1 日分のメモ長 (~10^3 文字) 内で安全。

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss
)]

use chrono::{Datelike, Timelike};
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::logic::{marker, memokitto, world_color};

/// 同席プレイヤー (同名別 `vrchat_id` を区別するため `user_id` を保持)
#[derive(Serialize, Clone)]
pub struct VisitPlayer {
    pub user_id: String,
    pub name: String,
}

/// ワールド訪問ブロック（タイムライン表示用）
///
/// R2-M-26: `StellaRecord` の `visit_summary` ビューは `world_id` (`wrld_xxx`) を
/// 保持していない (`visits` テーブル自体に列が無い) ため、Mira は `world_name`
/// 基準で色を固定する。ワールドが改名された場合は別ワールド扱いになる制約あり。
#[derive(Serialize, Clone)]
pub struct VisitBlock {
    pub world_name: String,
    pub color_hex: String,
    pub start_hour: f32,
    pub end_hour: f32,
    pub duration_min: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub players: Option<Vec<VisitPlayer>>,
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
    pub co_visit_count: u32,
}

/// メモ内の自動検出マーカー範囲。start/end は **UTF-16 コードユニット位置** で返す
/// (フロントの JS 文字列インデックスに合わせるため、marker.rs 内で byte → UTF-16 変換済み)
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

/// ユーザーが手動で付けたマーカー。
/// start/end はフロントの getSelectionOffsets が算出した UTF-16 コードユニット位置 (DB にそのまま格納)
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
}

/// `week_start` (日曜日, YYYY-MM-DD) から 7 日分のレーンデータを返す。
/// 表示時間帯 `hour_start/hour_end` は設定値があれば優先、無ければ過去 30 日の活動傾向から自動検出する。
#[tauri::command]
pub fn get_week_lane_data(
    state: State<'_, DbState>,
    week_start: String,
) -> Result<WeekLaneData, String> {
    let stella_guard = crate::db::lock_stella(&state)?;
    let mira = crate::db::lock_mira(&state)?;

    let stella = stella_guard
        .as_ref()
        .ok_or_else(|| "StellaRecord not connected".to_string())?;

    let start_date =
        chrono::NaiveDate::parse_from_str(&week_start, "%Y-%m-%d").map_err(|e| e.to_string())?;

    // 自動検出 (5%/95% パーセンタイル) を既定値とし、ユーザー設定があれば上書き
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

/// `HomePage` のフォーカスビュー用に、指定日のあらゆる情報をまとめて返す。
/// 取得順は visits → 人 → 写真 → memo → マーカー (自動・手動) → メモきっと候補、と依存順。
#[tauri::command]
pub fn get_day_focus_data(state: State<'_, DbState>, date: String) -> Result<DayFocusData, String> {
    let stella_guard = crate::db::lock_stella(&state)?;
    let mira = crate::db::lock_mira(&state)?;

    let stella = stella_guard
        .as_ref()
        .ok_or_else(|| "StellaRecord not connected".to_string())?;

    let mut visits = query_visits_for_date(stella, &mira, &date)?;
    let total_duration_min: u32 = visits.iter().map(|v| v.duration_min).sum();

    attach_players_to_visits(stella, &date, &mut visits);

    let people = query_people_for_date(stella, &date)?;
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
    })
}

/// 指定日のメモを upsert (date 主キーで INSERT or UPDATE) する。
/// フロントの maxLength と二重に 1000 文字で切る（バイト数ではなく文字数ベースで切るため
/// `char_indices().nth()` で 1001 文字目の byte 位置を取得し、その手前で slice する）。
#[tauri::command]
pub fn save_day_memo(state: State<'_, DbState>, date: String, memo: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 設定 memo_max_length を優先し、なければデフォルト 1000 文字
    let max_chars: usize = mira
        .query_row(
            "SELECT value FROM mira_settings WHERE key = 'memo_max_length'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);

    let max_len = memo
        .char_indices()
        .nth(max_chars)
        .map_or(memo.len(), |(i, _)| i);
    let trimmed = &memo[..max_len];

    // R2-M-17: 新規 INSERT 時に data_version を "1" で明示する (NULL 化を避ける)
    mira.execute(
        "INSERT INTO mira_journal_entries (date, user_memo, data_version, created_at, updated_at)
         VALUES (?1, ?2, '1', ?3, ?3)
         ON CONFLICT(date) DO UPDATE SET user_memo = ?2, updated_at = ?3",
        rusqlite::params![date, trimmed, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 手動マーカーで許可された色 (UI のカラーピッカー選択肢と同期)
const ALLOWED_MARKER_COLORS: &[&str] = &["red", "blue", "green", "orange"];

/// 手動マーカーを追加し、挿入されたIDを返す
///
/// R2-M-6: start < end / color 許可集合 / memo 長との越境を検証する
#[tauri::command]
pub fn add_manual_marker(
    state: State<'_, DbState>,
    date: String,
    start: usize,
    end: usize,
    color: String,
) -> Result<i64, String> {
    // start < end
    if start >= end {
        return Err(format!("invalid marker range: {start} >= {end}"));
    }
    // 許可された color のみ受け付ける
    if !ALLOWED_MARKER_COLORS.contains(&color.as_str()) {
        return Err(format!("invalid marker color: {color}"));
    }

    let mira = crate::db::lock_mira(&state)?;

    // memo 文字数 (UTF-16 単位) を取得し、end が越境していないか確認する
    let memo_len_utf16: usize = mira
        .query_row(
            "SELECT user_memo FROM mira_journal_entries WHERE date = ?1",
            [&date],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .map_or(0, |s| s.encode_utf16().count());
    if end > memo_len_utf16 {
        return Err(format!(
            "marker end ({end}) exceeds memo length ({memo_len_utf16})"
        ));
    }

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
    let mira = crate::db::lock_mira(&state)?;
    mira.execute("DELETE FROM mira_manual_markers WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 指定日の手動マーカーを start_pos 昇順で読み込む。SQL/conversion 失敗時は空 Vec を返してフロントを壊さない
fn load_manual_markers(mira: &rusqlite::Connection, date: &str) -> Vec<ManualMarker> {
    let Ok(mut stmt) = mira.prepare(
        "SELECT id, start_pos, end_pos, color FROM mira_manual_markers WHERE date = ?1 ORDER BY start_pos",
    ) else {
        return Vec::new();
    };

    stmt.query_map([date], |row| {
        // DB に万が一負値が入っていても安全側 (0 へクランプ) に倒す
        let start_raw = row.get::<_, i64>(1)?;
        let end_raw = row.get::<_, i64>(2)?;
        Ok(ManualMarker {
            id: row.get(0)?,
            start: usize::try_from(start_raw).unwrap_or(0),
            end: usize::try_from(end_raw).unwrap_or(0),
            color: row.get(3)?,
        })
    })
    .map(|rows| rows.filter_map(std::result::Result::ok).collect())
    .unwrap_or_default()
}

// 指定日 (ローカル日付) の訪問サマリを STELLA から取得し、世界色を Mira 側で付与する。
// leave_time が NULL のレコードは duration_sec から終了時刻を推定する（VRC 起動中に終わった訪問）。
fn query_visits_for_date(
    stella: &rusqlite::Connection,
    mira: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<VisitBlock>, String> {
    let mut stmt = stella
        .prepare(
            "SELECT world_name, join_time, leave_time, duration_sec
             FROM visit_summary
             WHERE date(join_time) = ?1
             ORDER BY join_time",
        )
        .map_err(|e| e.to_string())?;

    let visits = stmt
        .query_map([date], |row| {
            let world_name: String = row.get(0)?;
            let join_time: String = row.get(1)?;
            let leave_time: Option<String> = row.get(2)?;
            let duration_sec: u32 = row.get::<_, Option<u32>>(3)?.unwrap_or(0);

            let start_hour = parse_hour_fraction(&join_time);
            // R2-M-16: leave_time が NULL かつ duration_sec=0 だと end==start となり
            // ブロック高さがゼロで描画消失する。
            // - duration_sec から end を出す。
            // - 0 のときは「現在進行中」と見なし、今が join 日付なら now まで、
            //   過去日なら最低 +0.1h (約 6 分) の高さを保証する。
            let end_hour = leave_time.as_deref().map_or_else(
                || {
                    if duration_sec > 0 {
                        start_hour + (duration_sec as f32 / 3600.0)
                    } else {
                        // join 日が今日かどうかでフォールバック先を変える
                        let now = chrono::Local::now();
                        let today_str = now.format("%Y-%m-%d").to_string();
                        let join_date = join_time.split([' ', 'T']).next().unwrap_or("");
                        if join_date == today_str {
                            let now_h = now.hour() as f32
                                + now.minute() as f32 / 60.0
                                + now.second() as f32 / 3600.0;
                            (start_hour + 0.1).max(now_h)
                        } else {
                            start_hour + 0.1
                        }
                    }
                },
                parse_hour_fraction,
            );

            Ok((world_name, start_hour, end_hour, duration_sec / 60))
        })
        .map_err(|e| e.to_string())?
        .filter_map(std::result::Result::ok)
        .map(|(world_name, start_hour, end_hour, duration_min)| {
            // R2-M-26: world_name ベースで色生成 (StellaRecord に world_id が無いため)
            let color_hex = get_or_generate_world_color(mira, &world_name);
            VisitBlock {
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

// 指定日に同席した自分以外のユーザーを共訪問回数の多い順で返す。お気に入りフラグは Mira DB を別途参照。
fn query_people_for_date(
    stella: &rusqlite::Connection,
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
            Ok(PersonChip {
                user_id: row.get(0)?,
                display_name: row.get(1)?,
                co_visit_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(std::result::Result::ok)
        .collect();

    Ok(people)
}

// 指定日に撮影されたスクリーンショットを時系列で返す。hour は訪問ブロックとの時間突合に使う
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
        .filter_map(std::result::Result::ok)
        .collect();

    Ok(photos)
}

// 各訪問ブロックに同席プレイヤー (user_id + name) を紐付ける
//
// R2-M-22: 同名別 vrchat_id が混在しても区別できるよう user_id を保持する。
fn attach_players_to_visits(stella: &rusqlite::Connection, date: &str, visits: &mut [VisitBlock]) {
    let Ok(mut stmt) = stella.prepare(
        "SELECT v.join_time, fu.vrchat_id, fu.account_name
         FROM with_users wu
         JOIN find_users fu ON fu.vrchat_id = wu.vrchat_id
         JOIN visits v ON v.id = wu.visit_id
         WHERE wu.is_self = 0 AND date(v.join_time) = ?1
         ORDER BY v.join_time, fu.account_name",
    ) else {
        return;
    };

    let Ok(rows) = stmt.query_map([date], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) else {
        return;
    };

    let entries: Vec<(f32, String, String)> = rows
        .filter_map(std::result::Result::ok)
        .map(|(join_time, uid, name)| (parse_hour_fraction(&join_time), uid, name))
        .collect();

    for visit in visits.iter_mut() {
        let mut players: Vec<VisitPlayer> = Vec::new();
        let mut seen_uids: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for (h, uid, name) in &entries {
            if *h < visit.start_hour || *h >= visit.end_hour {
                continue;
            }
            if seen_uids.insert(uid.as_str()) {
                players.push(VisitPlayer {
                    user_id: uid.clone(),
                    name: name.clone(),
                });
            }
        }
        visit.players = if players.is_empty() {
            None
        } else {
            Some(players)
        };
    }
}

// ワールド名に対応する色を取得し、なければ生成して保存する
//
// R2-M-26: `world_name` ベースで色を固定する (`StellaRecord` の `visit_summary` ビューに
// `world_id` 列が無いため)。ワールドが改名された場合は新規ワールド扱いとなり別の色になる
// 制約があるが、StellaRecord 側の変更を避ける現状の妥協策。
fn get_or_generate_world_color(mira: &rusqlite::Connection, world_name: &str) -> String {
    if let Ok(color) = mira.query_row(
        "SELECT color_hex FROM mira_world_colors WHERE world_name = ?1",
        [world_name],
        |row| row.get::<_, String>(0),
    ) {
        return color;
    }

    let color = world_color::generate_color(world_name);
    let _ = mira.execute(
        "INSERT OR IGNORE INTO mira_world_colors (world_name, color_hex, is_custom) VALUES (?1, ?2, 0)",
        rusqlite::params![world_name, &color],
    );

    color
}

// mira_settings から u8 値を取り出す。空文字や 0 は「未設定」と同義とみなして None を返す
// (デフォルト値で開始 → ユーザーが明示的に正の値を入れた時のみ採用、の挙動を実現するため)
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

// "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS" の時刻部を小数 hour に変換 (14:30 -> 14.5)。
// 区切り (' ' or 'T') 未対応や数値パース失敗時は 0.0 にフォールバック。
fn parse_hour_fraction(datetime_str: &str) -> f32 {
    let time_part = datetime_str.split([' ', 'T']).nth(1).unwrap_or("00:00:00");
    let parts: Vec<&str> = time_part.split(':').collect();
    let h: f32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let m: f32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    h + m / 60.0
}

// chrono::Weekday を英語 3 文字略称 (Sun..Sat) に変換する。フロントの day-head 表示用
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

// chrono::Weekday を日本語表記 (月曜日..日曜日) に変換する。memo パネルの日付見出し用
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
