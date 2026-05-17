//! 日次ジャーナル機能の `Tauri` コマンド群。週レーンの可視化・日別フォーカス表示・メモ保存・
//! 手動マーカー編集を提供する。
//!
//! 1 日分の集計値 (人数・写真数・経過秒) を u32/f32 に変換する箇所が多数あるが、
//! いずれも 1 日分の活動量という現実的上限内 (~10^3 規模) なので
//! `truncation` / `precision_loss` は許容する (`#![allow(clippy::cast_*)]` を参照)。
//! マーカーの **Unicode scalar (char) 位置** を i64 として DB に格納する箇所も 1 日分の
//! メモ長 (~10^3 文字) 内で安全。L7-MarkerUnit で UTF-16 単位から scalar 単位に統一済み。

#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_precision_loss
)]

use chrono::{Datelike, Timelike};
use serde::Serialize;
use tauri::State;

use crate::commands::DEFAULT_MEMO_MAX_LENGTH;
use crate::db::DbState;
use crate::logic::{marker, memokitto, world_color};
use crate::utils::logging;

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

/// メモ内の自動検出マーカー範囲。start/end は **Unicode scalar (char) 位置** で返す
/// (フロントの `Array.from(memo).length` と同単位; marker.rs 内で byte → char 変換済み)
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
/// start/end はフロントの `getSelectionOffsets` が算出した **Unicode scalar (char) 位置**
/// (`Array.from(s).length` ベース)。DB にそのまま格納し、Rust 全層でも char 単位で扱う。
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
        // L4 R4-Err-8: 文言ハードコードを避け、フロント側で `MESSAGES.errors.stellaUnavailable`
        //   にマッピングするためエラーコードで返す (i18n / 文言ぶれ対策)。
        .ok_or_else(|| "STELLA_UNAVAILABLE".to_string())?;

    let start_date = chrono::NaiveDate::parse_from_str(&week_start, "%Y-%m-%d").map_err(|e| {
        // L6 Log-7: week_start はユーザー入力 (≒ 日付選択値) なので redact してログに残す
        logging::log_error(
            "journal",
            &format!(
                "week_start パース失敗 value={} err={e}",
                logging::redact(&week_start)
            ),
        );
        "週開始日の形式が不正です".to_string()
    })?;

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
        // L4 R4-Err-8: 文言ハードコードを避け、フロント側で `MESSAGES.errors.stellaUnavailable`
        //   にマッピングするためエラーコードで返す (i18n / 文言ぶれ対策)。
        .ok_or_else(|| "STELLA_UNAVAILABLE".to_string())?;

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

    let parsed_date = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| {
        logging::log_error(
            "journal",
            &format!("date パース失敗 value={} err={e}", logging::redact(&date)),
        );
        "日付の形式が不正です".to_string()
    })?;
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
///
/// M6: メモ短縮で既存 `manual_markers.end` が `new_memo` の Unicode scalar 長を超えた場合は
/// その end を memo 末尾にクリップする (start >= memo 長になるマーカーは保護のため削除)。
/// 削除ではなくクリップ優先にすることで、ユーザーが付けたマーカーの「存在」自体を残す。
///
/// L7-OrphanClean: メモ本文が **空文字列** で保存される場合 (= ユーザーが全消去) は、
///   当該日付の `manual_markers` を一括 DELETE する。位置 0..0 のマーカーは表示時に
///   `start < end` チェックで除外されるが、DB に空マーカーが残ると orphan データになる
///   ため (フロント描画にも IPC ペイロードにも乗らない無駄)、ここで明示掃除する。
#[tauri::command]
pub fn save_day_memo(state: State<'_, DbState>, date: String, memo: String) -> Result<(), String> {
    let mut mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 設定 memo_max_length を優先し、なければデフォルト (DEFAULT_MEMO_MAX_LENGTH = 1000) を採用
    //
    // L3 R3-Sec-4: 動作仕様 — 設定値を超える長さの memo を受け取った場合、
    //   エラー返却ではなく **自動切り詰め (silent truncation)** で保存する。
    //   - UI 側にも文字数カウンタ + maxlength があるため、超過は通常発生しない。
    //   - DB 内に肥大化メモが蓄積するのを防ぐサーバ側の最終防衛線として機能する。
    //   - 切り詰めは UTF-8 char_indices ベースで安全境界を確保 (マルチバイト分割なし)。
    let max_chars: usize = mira
        .query_row(
            "SELECT value FROM mira_settings WHERE key = 'memo_max_length'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| usize::try_from(DEFAULT_MEMO_MAX_LENGTH).unwrap_or(1000));

    let max_len = memo
        .char_indices()
        .nth(max_chars)
        .map_or(memo.len(), |(i, _)| i);
    let trimmed = &memo[..max_len];

    // クリップ用に新メモの **Unicode scalar 長** を i64 で算出
    //   (L7-MarkerUnit: manual_markers.start_pos/end_pos は scalar 単位で格納されている)
    let new_memo_char_len = i64::try_from(trimmed.chars().count()).unwrap_or(i64::MAX);
    let is_memo_empty = trimmed.is_empty();

    // 同一トランザクションでメモ upsert + マーカーのクリップ/掃除を実行し、
    // 表示時にずれた範囲が見えないようにする。
    let tx = mira.transaction().map_err(|e| {
        logging::log_error(
            "journal",
            &format!("save_day_memo transaction 開始失敗: {e}"),
        );
        "メモの保存に失敗しました".to_string()
    })?;

    // L2 R2-10: data_version 列はマイグレーションで撤去済 (旧仕様の dead field)。
    // INSERT 側からも参照を除去し、撤去後の環境で SQL エラーにならないようにする。
    tx.execute(
        "INSERT INTO mira_journal_entries (date, user_memo, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(date) DO UPDATE SET user_memo = ?2, updated_at = ?3",
        rusqlite::params![date, trimmed, now],
    )
    .map_err(|e| {
        logging::log_error("journal", &format!("save_day_memo INSERT 失敗: {e}"));
        "メモの保存に失敗しました".to_string()
    })?;

    if is_memo_empty {
        // L7-OrphanClean: 空メモなら手動マーカーを全削除し、クリップ処理はスキップ。
        //   memo_char_len=0 だと UPDATE/DELETE の条件 `start_pos < 0` などが偽になり
        //   何も消えないため、空メモ専用のショートカットとして date 単位 DELETE を実行する。
        tx.execute(
            "DELETE FROM mira_manual_markers WHERE date = ?1",
            rusqlite::params![date],
        )
        .map_err(|e| {
            logging::log_error("journal", &format!("manual_marker 全削除失敗: {e}"));
            "メモの保存に失敗しました".to_string()
        })?;
    } else {
        // M6: end が新メモ長を超えるマーカーは end を memo 長へクリップする。
        // start >= memo 長まで縮んだケースは start < end 制約を破壊するため、別途削除する。
        tx.execute(
            "UPDATE mira_manual_markers
             SET end_pos = ?1
             WHERE date = ?2 AND end_pos > ?1 AND start_pos < ?1",
            rusqlite::params![new_memo_char_len, date],
        )
        .map_err(|e| {
            logging::log_error("journal", &format!("manual_marker クリップ失敗: {e}"));
            "メモの保存に失敗しました".to_string()
        })?;
        tx.execute(
            "DELETE FROM mira_manual_markers
             WHERE date = ?1 AND start_pos >= ?2",
            rusqlite::params![date, new_memo_char_len],
        )
        .map_err(|e| {
            logging::log_error("journal", &format!("manual_marker 範囲外削除失敗: {e}"));
            "メモの保存に失敗しました".to_string()
        })?;
    }

    tx.commit().map_err(|e| {
        logging::log_error("journal", &format!("save_day_memo commit 失敗: {e}"));
        "メモの保存に失敗しました".to_string()
    })?;

    // M7 補足: 自動マーカー (memo_markers) は DB に保存されず、`get_day_focus_data` 内で
    // 毎回 `marker::find_markers` で再計算されるため、ここでの再計算保存は不要。
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
    // L3 R3-Sec-3: エラーメッセージにユーザー入力値を含めない (XSS / 情報漏洩防御)。
    //   詳細は eprintln でログにのみ残す。
    // start < end
    if start >= end {
        logging::log_warn(
            "journal",
            &format!("add_manual_marker: 範囲不正 start={start} end={end}"),
        );
        return Err("マーカー範囲が不正です".to_string());
    }
    // 許可された color のみ受け付ける
    if !ALLOWED_MARKER_COLORS.contains(&color.as_str()) {
        // color はユーザー入力なので redact
        logging::log_warn(
            "journal",
            &format!(
                "add_manual_marker: 色不正 color={}",
                logging::redact(&color)
            ),
        );
        return Err("マーカー色が不正です".to_string());
    }

    let mira = crate::db::lock_mira(&state)?;

    // L7-MarkerUnit: memo 文字数を **Unicode scalar (char) 単位** で取得し、
    //   end が越境していないか確認する。フロントの `Array.from(memo).length` と同単位。
    let memo_len_char: usize = mira
        .query_row(
            "SELECT user_memo FROM mira_journal_entries WHERE date = ?1",
            [&date],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .map_or(0, |s| s.chars().count());
    if end > memo_len_char {
        logging::log_warn(
            "journal",
            &format!("add_manual_marker: end={end} がメモ長 {memo_len_char} を超過"),
        );
        return Err("マーカー終端がメモ長を超えています".to_string());
    }

    mira.execute(
        "INSERT INTO mira_manual_markers (date, start_pos, end_pos, color) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![date, start as i64, end as i64, color],
    )
    .map_err(|e| {
        logging::log_error("journal", &format!("manual_marker INSERT 失敗: {e}"));
        "マーカーの保存に失敗しました".to_string()
    })?;
    Ok(mira.last_insert_rowid())
}

/// 指定IDの手動マーカーを削除する
#[tauri::command]
pub fn remove_manual_marker(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    mira.execute("DELETE FROM mira_manual_markers WHERE id = ?1", [id])
        .map_err(|e| {
            logging::log_error("journal", &format!("manual_marker DELETE 失敗: {e}"));
            "マーカーの削除に失敗しました".to_string()
        })?;
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
//
// M10: visit ごとの単発 SELECT/INSERT (N+1) を解消するため、ユニーク world_name
// をまとめて IN 句で取得し、欠けているものだけ 1 トランザクションで INSERT する。
fn query_visits_for_date(
    stella: &rusqlite::Connection,
    mira: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<VisitBlock>, String> {
    // L5 SQL-Opt-1: date(join_time) ラッパは join_time INDEX を無効化するため、
    //   半開区間 [date 00:00, date+1 00:00) で SARGable に置き換える。
    let next_day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| {
            (d + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        })
        .map_err(|e| {
            logging::log_error("journal", &format!("visits date parse 失敗: {e}"));
            "訪問データの取得に失敗しました".to_string()
        })?;
    let day_start = format!("{date} 00:00:00");
    let day_end = format!("{next_day} 00:00:00");

    let mut stmt = stella
        .prepare(
            "SELECT world_name, join_time, leave_time, duration_sec
             FROM visit_summary
             WHERE join_time >= ?1 AND join_time < ?2
             ORDER BY join_time",
        )
        .map_err(|e| {
            logging::log_error("journal", &format!("visits prepare 失敗: {e}"));
            "訪問データの取得に失敗しました".to_string()
        })?;

    let raw_visits: Vec<(String, f32, f32, u32)> = stmt
        .query_map([&day_start, &day_end], |row| {
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
        .map_err(|e| {
            logging::log_error("journal", &format!("visits query_map 失敗: {e}"));
            "訪問データの取得に失敗しました".to_string()
        })?
        .filter_map(std::result::Result::ok)
        .collect();

    // ユニーク world_name を抽出し、色を一括で解決 (既存色取得 + 欠落分一括 INSERT)
    let unique_worlds: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for (w, _, _, _) in &raw_visits {
            if seen.insert(w.clone()) {
                out.push(w.clone());
            }
        }
        out
    };
    let color_map = resolve_world_colors_bulk(mira, &unique_worlds);

    let visits = raw_visits
        .into_iter()
        .map(|(world_name, start_hour, end_hour, duration_min)| {
            let color_hex = color_map
                .get(&world_name)
                .cloned()
                .unwrap_or_else(|| world_color::generate_color(&world_name));
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

// ユニーク world_name 集合に対する色マップを 1 SELECT + 最小 INSERT で構築する。
//
// 1. `mira_world_colors` から既存色を IN 句一括 SELECT
// 2. 未登録 world のみ FNV-1a ハッシュで色生成し、まとめて INSERT OR IGNORE
//
// SELECT/INSERT 失敗時は空 / 部分マップを返し、上位は generate_color フォールバックで補う
// (色生成は決定論的なため再起動しても同じ色になる)。
fn resolve_world_colors_bulk(
    mira: &rusqlite::Connection,
    worlds: &[String],
) -> std::collections::HashMap<String, String> {
    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    if worlds.is_empty() {
        return map;
    }

    // プレースホルダを world 件数だけ動的に組み立てる (rusqlite::params_from_iter で渡す)
    let placeholders = std::iter::repeat_n("?", worlds.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT world_name, color_hex FROM mira_world_colors WHERE world_name IN ({placeholders})"
    );
    if let Ok(mut stmt) = mira.prepare(&sql) {
        if let Ok(rows) = stmt.query_map(rusqlite::params_from_iter(worlds.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for (name, color) in rows.filter_map(std::result::Result::ok) {
                map.insert(name, color);
            }
        }
    }

    // 未登録 world を生成して一括 INSERT。
    // L2 R2-16: ループ内 1 行ずつ autocommit させると TOCTOU で複数訪問世界の登録順序が乱れ、
    //   並列起動時 (2 ウインドウ同時オープン等) に「片方が INSERT、もう片方が INSERT OR IGNORE」
    //   の race 順序により最終色がぶれる可能性があった。
    //   `unchecked_transaction()` で 1 トランザクションに束ね、map 反映も commit 後にまとめる
    //   (rollback 時は generate_color フォールバックに任せて map には載せない)。
    let missing: Vec<(&String, String)> = worlds
        .iter()
        .filter(|w| !map.contains_key(w.as_str()))
        .map(|w| (w, world_color::generate_color(w)))
        .collect();
    if missing.is_empty() {
        return map;
    }
    // unchecked_transaction は `&Connection` で開始可能。借用検査の代わりに
    // 「同関数内で他の Tx を開始しない」運用ルールで担保する (本関数は単独で完結)。
    let tx_result = mira.unchecked_transaction();
    if let Ok(tx) = tx_result {
        let mut all_ok = true;
        for (name, color) in &missing {
            if tx
                .execute(
                    "INSERT OR IGNORE INTO mira_world_colors (world_name, color_hex, is_custom) VALUES (?1, ?2, 0)",
                    rusqlite::params![name, color],
                )
                .is_err()
            {
                all_ok = false;
                break;
            }
        }
        if all_ok && tx.commit().is_ok() {
            for (name, color) in missing {
                map.insert(name.clone(), color);
            }
        }
        // commit 失敗時 / 途中失敗時は何も map に追加せず、上位で generate_color フォールバック
    }

    map
}

// 指定日に同席した自分以外のユーザーを共訪問回数の多い順で返す。お気に入りフラグは Mira DB を別途参照。
fn query_people_for_date(
    stella: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<PersonChip>, String> {
    // L5 SQL-Opt-1: date(v.join_time) は INDEX が効かないため半開区間で置換
    let next_day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| {
            (d + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        })
        .map_err(|e| {
            logging::log_error("journal", &format!("people date parse 失敗: {e}"));
            "同席プレイヤーの取得に失敗しました".to_string()
        })?;
    let day_start = format!("{date} 00:00:00");
    let day_end = format!("{next_day} 00:00:00");

    let mut stmt = stella
        .prepare(
            "SELECT fu.vrchat_id, fu.account_name, COUNT(DISTINCT wu.visit_id) AS co_visit_count
             FROM with_users wu
             JOIN find_users fu ON fu.vrchat_id = wu.vrchat_id
             JOIN visits v ON v.id = wu.visit_id
             WHERE wu.is_self = 0 AND v.join_time >= ?1 AND v.join_time < ?2
             GROUP BY fu.vrchat_id
             ORDER BY co_visit_count DESC",
        )
        .map_err(|e| {
            logging::log_error("journal", &format!("people prepare 失敗: {e}"));
            "同席プレイヤーの取得に失敗しました".to_string()
        })?;

    let people = stmt
        .query_map([&day_start, &day_end], |row| {
            Ok(PersonChip {
                user_id: row.get(0)?,
                display_name: row.get(1)?,
                co_visit_count: row.get(2)?,
            })
        })
        .map_err(|e| {
            logging::log_error("journal", &format!("people query_map 失敗: {e}"));
            "同席プレイヤーの取得に失敗しました".to_string()
        })?
        .filter_map(std::result::Result::ok)
        .collect();

    Ok(people)
}

// 指定日に撮影されたスクリーンショットを時系列で返す。hour は訪問ブロックとの時間突合に使う
fn query_photos_for_date(
    stella: &rusqlite::Connection,
    date: &str,
) -> Result<Vec<PhotoEntry>, String> {
    // L5 SQL-Opt-1: date(timestamp) は INDEX が効かないため半開区間で置換
    let next_day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map(|d| {
            (d + chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string()
        })
        .map_err(|e| {
            logging::log_error("journal", &format!("photos date parse 失敗: {e}"));
            "スクリーンショットの取得に失敗しました".to_string()
        })?;
    let day_start = format!("{date} 00:00:00");
    let day_end = format!("{next_day} 00:00:00");

    let mut stmt = stella
        .prepare(
            "SELECT file_path, timestamp FROM screenshots
             WHERE timestamp >= ?1 AND timestamp < ?2
             ORDER BY timestamp",
        )
        .map_err(|e| {
            logging::log_error("journal", &format!("photos prepare 失敗: {e}"));
            "スクリーンショットの取得に失敗しました".to_string()
        })?;

    let photos = stmt
        .query_map([&day_start, &day_end], |row| {
            let file_path: String = row.get(0)?;
            let ts: String = row.get(1)?;
            let hour = parse_hour_fraction(&ts);
            Ok(PhotoEntry { file_path, hour })
        })
        .map_err(|e| {
            logging::log_error("journal", &format!("photos query_map 失敗: {e}"));
            "スクリーンショットの取得に失敗しました".to_string()
        })?
        .filter_map(std::result::Result::ok)
        .collect();

    Ok(photos)
}

// 各訪問ブロックに同席プレイヤー (user_id + name) を紐付ける
//
// R2-M-22: 同名別 vrchat_id が混在しても区別できるよう user_id を保持する。
fn attach_players_to_visits(stella: &rusqlite::Connection, date: &str, visits: &mut [VisitBlock]) {
    // L5 SQL-Opt-1: date(v.join_time) は INDEX が効かないため半開区間で置換
    let Ok(parsed) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") else {
        // date は内部で組み立てた "YYYY-MM-DD" 形式の想定だが、念のため redact
        logging::log_error(
            "journal",
            &format!("attach_players date parse 失敗: {}", logging::redact(date)),
        );
        return;
    };
    let next_day = (parsed + chrono::Duration::days(1))
        .format("%Y-%m-%d")
        .to_string();
    let day_start = format!("{date} 00:00:00");
    let day_end = format!("{next_day} 00:00:00");

    let Ok(mut stmt) = stella.prepare(
        "SELECT v.join_time, fu.vrchat_id, fu.account_name
         FROM with_users wu
         JOIN find_users fu ON fu.vrchat_id = wu.vrchat_id
         JOIN visits v ON v.id = wu.visit_id
         WHERE wu.is_self = 0 AND v.join_time >= ?1 AND v.join_time < ?2
         ORDER BY v.join_time, fu.account_name",
    ) else {
        return;
    };

    let Ok(rows) = stmt.query_map([&day_start, &day_end], |row| {
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
