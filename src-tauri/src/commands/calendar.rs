//! カレンダー機能の `Tauri` コマンド群。月別アクティブ日一覧 + ユーザー予定 (`mira_scheduled_events`)
//! の CRUD を提供する。週次繰り返し (`recurrence_kind = "weekly"`) のみ対応。

use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;

use crate::commands::REMIND_MIN_MAX;
use crate::db::DbState;
use crate::utils::logging;

/// L4 D-INT-4: `scheduled_at` の形式ゆらぎを 1 箇所で吸収する。
///   許容形式:
///     - "YYYY-MM-DD HH:MM"
///     - "YYYY-MM-DD HH:MM:SS"
///     - "YYYY-MM-DDTHH:MM"
///     - "YYYY-MM-DDTHH:MM:SS"
///   いずれかで parse 成功すれば、内部保存形式 "YYYY-MM-DD HH:MM:SS" に正規化して返す。
///   全て失敗した場合は Err を返し、呼出側でユーザー向けエラーメッセージに変換する。
fn normalize_scheduled_at(scheduled_at: &str) -> Result<String, String> {
    const FORMATS: &[&str] = &[
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
    ];
    for fmt in FORMATS {
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(scheduled_at, fmt) {
            return Ok(dt.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    // L3 R3-Sec-3: ユーザー向けメッセージには raw 値を出さない。
    // L6 Log-7: scheduled_at はユーザー入力 (フォーム由来) なので長さ表示のみで記録する。
    logging::log_warn(
        "calendar",
        &format!(
            "scheduled_at 形式不正 value={}",
            logging::redact(scheduled_at)
        ),
    );
    Err("日時の形式が不正です".to_string())
}

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
    /// 繰り返し種別 (現状 `"weekly"` または `None`)。編集モーダルの初期値判定に使う。
    pub recurrence_kind: Option<String>,
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
                .map_err(|e| {
                    logging::log_error("calendar", &format!("active_days prepare 失敗: {e}"));
                    "カレンダーの活動日取得に失敗しました".to_string()
                })?;

            let days = stmt
                .query_map([&date_prefix], |row| row.get(0))
                .map_err(|e| {
                    logging::log_error("calendar", &format!("active_days query_map 失敗: {e}"));
                    "カレンダーの活動日取得に失敗しました".to_string()
                })?
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
            "SELECT id, title, scheduled_at, remind_minutes_before, recurrence_kind
             FROM mira_scheduled_events
             WHERE substr(scheduled_at, 1, 7) = ?1
             ORDER BY scheduled_at",
        )
        .map_err(|e| {
            logging::log_error("calendar", &format!("events prepare 失敗: {e}"));
            "予定一覧の取得に失敗しました".to_string()
        })?;

    let events: Vec<CalendarEvent> = evt_stmt
        .query_map([&date_prefix], |row| {
            Ok(CalendarEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                scheduled_at: row.get(2)?,
                remind_minutes_before: row.get(3)?,
                recurrence_kind: row.get(4)?,
            })
        })
        .map_err(|e| {
            logging::log_error("calendar", &format!("events query_map 失敗: {e}"));
            "予定一覧の取得に失敗しました".to_string()
        })?
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
    // scheduled_at を検証 + 正規化 ("YYYY-MM-DD HH:MM:SS" に統一)。
    // L4 D-INT-4: 4 形式 ("YYYY-MM-DD HH:MM[:SS]" / "YYYY-MM-DDTHH:MM[:SS]") を受け付ける。
    let scheduled_at = normalize_scheduled_at(&scheduled_at)?;

    // remind_minutes_before は 0..=1440 に制限 (負値・極端値の混入を防止)
    // L4 R4-Err-11: エラーメッセージにユーザー入力値を含めない。詳細は eprintln のみ。
    if !(0..=REMIND_MIN_MAX).contains(&remind_minutes_before) {
        // remind_minutes_before は数値なので redact 不要 (PII を含まない)
        logging::log_warn(
            "calendar",
            &format!(
                "add_event: remind_minutes_before 範囲外 value={remind_minutes_before} max={REMIND_MIN_MAX}"
            ),
        );
        return Err("通知時間の指定が不正です".to_string());
    }

    // recurrence_kind は現状 `weekly` のみサポート (R2-M-1 参照)。それ以外は明確に弾く
    // ことで将来の文字列ドリフトを防ぐ。
    let recurring_flag = is_recurring.unwrap_or(false);
    let kind = if recurring_flag {
        let value = recurrence_kind.unwrap_or_else(|| "weekly".to_string());
        if value != "weekly" {
            // L4 R4-Err-11: 入力値を含めず汎用文言を返す (詳細は redact 済みでログ)
            logging::log_warn(
                "calendar",
                &format!(
                    "add_event: 未対応の recurrence_kind value={}",
                    logging::redact(&value)
                ),
            );
            return Err("繰り返し種別が不正です".to_string());
        }
        Some(value)
    } else {
        None
    };

    let mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let recurring_int: i64 = i64::from(recurring_flag);

    // 重複防止: 同じ (title, scheduled_at) の予定が既に存在すればエラー (UI 連打対策)
    // L5 SQL-Opt-4: COUNT(*) は条件一致行を全走査するが、存在チェックなら 1 行で打ち切れる。
    //   UNIQUE INDEX (idx_mira_scheduled_events_unique) を使って LIMIT 1 + optional で確認する。
    let exists = mira
        .query_row(
            "SELECT 1 FROM mira_scheduled_events WHERE title = ?1 AND scheduled_at = ?2 LIMIT 1",
            rusqlite::params![title, scheduled_at],
            |r| r.get::<_, i32>(0),
        )
        .optional()
        .unwrap_or(None)
        .is_some();
    if exists {
        // L3 R3-Sec-3 / L6 Log-7: title / scheduled_at は PII (予定内容) を含むため redact。
        logging::log_warn(
            "calendar",
            &format!(
                "add_event: 同名同時刻の予定が既に存在 title={} scheduled_at={}",
                logging::redact(&title),
                logging::redact(&scheduled_at),
            ),
        );
        return Err("同名同時刻の予定が既に登録されています".to_string());
    }

    mira.execute(
        "INSERT INTO mira_scheduled_events (event_type, title, scheduled_at, source, notify_on_launch, remind_minutes_before, reminded, is_recurring, recurrence_kind, created_at)
         VALUES ('reservation', ?1, ?2, 'user', 1, ?3, 0, ?4, ?5, ?6)",
        rusqlite::params![title, scheduled_at, remind_minutes_before, recurring_int, kind, now],
    )
    .map_err(|e| {
        logging::log_error("calendar", &format!("add_event INSERT 失敗: {e}"));
        "予定の追加に失敗しました".to_string()
    })?;

    Ok(mira.last_insert_rowid())
}

/// 指定 ID の予定イベントを物理削除する (履歴は残さない)
#[tauri::command]
pub fn remove_event(state: State<'_, DbState>, id: i64) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    mira.execute("DELETE FROM mira_scheduled_events WHERE id = ?1", [id])
        .map_err(|e| {
            logging::log_error("calendar", &format!("remove_event 失敗: {e}"));
            "予定の削除に失敗しました".to_string()
        })?;
    Ok(())
}

/// 既存予定イベントを更新する
///
/// 更新項目:
///   - `title` (必須、空文字不可)
///   - `scheduled_at` (`YYYY-MM-DD HH:MM[:SS]`)
///   - `recurrence_kind` (`"none"` / `"weekly"` のみ)
///   - `remind_minutes_before` (0..=`REMIND_MIN_MAX`)
///
/// `scheduled_at` を書き換えた場合は `reminded` / `last_fired_at` を初期化し、
/// 編集後の発火が抜け落ちないようにする。
#[tauri::command]
pub fn update_calendar_event(
    state: State<'_, DbState>,
    id: i64,
    title: String,
    scheduled_at: String,
    recurrence_kind: String,
    remind_minutes_before: i64,
) -> Result<(), String> {
    let trimmed = title.trim().to_string();
    if trimmed.is_empty() {
        return Err("タイトルは必須です".to_string());
    }

    // L4 D-INT-4: add_event と同様に 4 形式を受け付け、保存形式 "YYYY-MM-DD HH:MM:SS" に正規化する。
    let scheduled_at = normalize_scheduled_at(&scheduled_at)?;

    // L4 R4-Err-11: 入力値を含めず汎用文言を返す (詳細は eprintln)
    if !(0..=REMIND_MIN_MAX).contains(&remind_minutes_before) {
        logging::log_warn(
            "calendar",
            &format!(
                "update_calendar_event: remind_minutes_before 範囲外 value={remind_minutes_before}"
            ),
        );
        return Err("通知時間の指定が不正です".to_string());
    }

    // recurrence_kind は "none" / "weekly" のみ。
    // "none"  → is_recurring=0, recurrence_kind=NULL
    // "weekly" → is_recurring=1, recurrence_kind="weekly"
    let (is_recurring, kind): (i64, Option<String>) = match recurrence_kind.as_str() {
        "none" => (0, None),
        "weekly" => (1, Some("weekly".to_string())),
        other => {
            // L4 R4-Err-11: 入力値を含めず汎用文言を返す (redact 済み)
            logging::log_warn(
                "calendar",
                &format!(
                    "update_calendar_event: 未対応の recurrence_kind value={}",
                    logging::redact(other)
                ),
            );
            return Err("繰り返し種別が不正です".to_string());
        }
    };

    let mira = crate::db::lock_mira(&state)?;

    // scheduled_at を変更した場合は通知済みフラグを巻き戻し、編集後の予定が
    // 再び発火するようにする (既存値と比較して、変わらないなら触らない)。
    let prev_scheduled: Option<String> = mira
        .query_row(
            "SELECT scheduled_at FROM mira_scheduled_events WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .ok();
    let scheduled_changed = prev_scheduled.as_deref() != Some(scheduled_at.as_str());

    let updated = mira
        .execute(
            "UPDATE mira_scheduled_events
             SET title = ?1,
                 scheduled_at = ?2,
                 is_recurring = ?3,
                 recurrence_kind = ?4,
                 remind_minutes_before = ?5
             WHERE id = ?6",
            rusqlite::params![
                trimmed,
                scheduled_at,
                is_recurring,
                kind,
                remind_minutes_before,
                id
            ],
        )
        .map_err(|e| {
            logging::log_error(
                "calendar",
                &format!("update_calendar_event UPDATE 失敗: {e}"),
            );
            "予定の更新に失敗しました".to_string()
        })?;

    if updated == 0 {
        return Err(format!("予定 (id={id}) が見つかりません"));
    }

    if scheduled_changed {
        mira.execute(
            "UPDATE mira_scheduled_events
             SET reminded = 0, last_fired_at = NULL
             WHERE id = ?1",
            [id],
        )
        .map_err(|e| {
            logging::log_error(
                "calendar",
                &format!("update_calendar_event reminded 巻き戻し失敗: {e}"),
            );
            "予定の更新に失敗しました".to_string()
        })?;
    }

    Ok(())
}
