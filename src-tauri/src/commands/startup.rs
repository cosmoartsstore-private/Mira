//! アプリ起動時の Tauri コマンド群。`StellaRecord` 接続状況・初回オンボーディング判定・
//! 起動時リマインダー候補の取得と dismiss 処理、スナップショットレビュー誘導を統括する。

use chrono::Datelike;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::utils::logging;

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

    // 古い dismiss レコードを GC (30 日経過分)。
    // L2 R2-12: dismissed_at は "YYYY-MM-DD HH:MM:SS" 形式で書込まれており、
    //   date('now','-30 days') は時刻情報を落とすため当日内の差分でレコードが
    //   早期 GC されるリスクがあった。datetime() で時刻まで含めて比較する。
    // L4 D-INT-5: 比較基準を「当日 00:00 - 30 days」に明示化し、time-of-day による
    //   ±1 日ぶれを排除する (TTL は date 単位なので基準も date 単位に揃える)。
    let _ = mira.execute(
        "DELETE FROM mira_dismissed_events WHERE dismissed_at < datetime('now','-30 days','start of day')",
        [],
    );
    // L4 D-INT-1: orphan cleanup の安全化。
    //   従来は source_ref 全体を `CAST(... AS INTEGER)` していたため、`snapshot_xxx` 等の
    //   別 prefix が将来入った場合に 0 とみなされて全件「id 不在」判定で誤削除される恐れがあった。
    //   現行 source_ref の形式:
    //     - 非繰返し:  "<id>"           (数字のみ)
    //     - 週次繰返し: "<id>_YYYY-MM-DD" (先頭が数字 + アンダースコア + 日付)
    //     - 将来予約:  "event_<id>"     (明示プレフィクス付き)
    //   将来 `snapshot_*` 等の id ベースでない prefix を導入した時に巻き込まれないよう、
    //   「先頭が数字で始まるもの (旧形式: <id> / <id>_YYYY-MM-DD)」または
    //   「`event_` プレフィクス付きで残りが INTEGER」のみを対象に絞る。
    //   それ以外 (`snapshot_*` 等) は touch しないため、未知 prefix の dismiss は明示的に skip される。
    let _ = mira.execute(
        "DELETE FROM mira_dismissed_events
         WHERE (
                 -- 旧形式: 先頭が数字 (非繰返し <id> / 週次 <id>_YYYY-MM-DD)
                 substr(source_ref, 1, 1) BETWEEN '0' AND '9'
                 AND CAST(
                       CASE WHEN instr(source_ref, '_') > 0
                            THEN substr(source_ref, 1, instr(source_ref, '_') - 1)
                            ELSE source_ref
                       END AS INTEGER
                     ) NOT IN (SELECT id FROM mira_scheduled_events)
               )
            OR (
                 -- 新形式: event_<id>
                 substr(source_ref, 1, 6) = 'event_'
                 AND CAST(substr(source_ref, 7) AS INTEGER)
                     NOT IN (SELECT id FROM mira_scheduled_events)
               )",
        [],
    );

    // L4 D-INT-2: 週次予定の不変条件破裂 (reminded=1 だが last_fired_at IS NULL) を自動修復。
    //   仕様上、週次予定は last_fired_at をその日に書込むことで次回まで抑止される。
    //   reminded=1 のまま last_fired_at が空になっていると永久に発火しない (停止状態) になるため、
    //   reminded を 0 に戻して次回ポーリングで last_fired_at を更新できる状態に揃える。
    // L5 SQL-Opt-2: is_recurring は NOT NULL DEFAULT 0 が保証されているため COALESCE は不要。
    //   SARGable な比較に統一して INDEX を効きやすくする。
    let _ = mira.execute(
        "UPDATE mira_scheduled_events
         SET reminded = 0
         WHERE is_recurring = 1
           AND reminded = 1
           AND last_fired_at IS NULL",
        [],
    );

    // L4 D-INT-3: view_hour_start/end が壊れた場合のフェイルセーフ。
    //   set_view_hour_range / set_setting は start < end を強制するが、
    //   過去版や外部書込で壊れた値が残った場合に備え、ここでデフォルト (空文字) に戻す。
    //   get_settings は空文字を 0 / 24 にフォールバックするため、デフォルト挙動に復帰する。
    let view_hour_start_raw = get_setting("view_hour_start");
    let view_hour_end_raw = get_setting("view_hour_end");
    if let (Ok(start), Ok(end)) = (
        view_hour_start_raw.parse::<u32>(),
        view_hour_end_raw.parse::<u32>(),
    ) {
        if start >= end || start > 30 || end > 30 {
            // start/end は時間範囲の数値 (0..=30) なので PII でない → redact 不要
            logging::log_warn(
                "startup",
                &format!(
                    "view_hour 設定値が不正 (start={start}, end={end}) のためデフォルトに戻します"
                ),
            );
            let _ = mira.execute(
                "INSERT OR REPLACE INTO mira_settings (key, value, value_type) VALUES ('view_hour_start', '', 'text')",
                [],
            );
            let _ = mira.execute(
                "INSERT OR REPLACE INTO mira_settings (key, value, value_type) VALUES ('view_hour_end', '', 'text')",
                [],
            );
        }
    }

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
pub fn get_pending_notifications(
    state: State<'_, DbState>,
) -> Result<Vec<ScheduleNotification>, String> {
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
    .map_err(|e| {
        logging::log_error("startup", &format!("dismiss INSERT 失敗: {e}"));
        "通知の dismiss に失敗しました".to_string()
    })?;
    Ok(())
}

/// 起動通知レビューを既読としてマークする (snapshot_* / annual_* キー)
///
/// L2 R2-15: `last_snapshot_seen` / `last_annual_seen` の値フォーマットを統一する。
///   - snapshot: `"YYYY-Qn"` (例: "2025-Q1") そのまま
///   - annual:   `"YYYY-annual"` (旧 "YYYY" → "YYYY-annual" に統一)
///   旧フォーマット ("YYYY") との後方互換を保つため、read 側 (`check_pending_review`)
///   では両方を受け付ける。
#[tauri::command]
pub fn mark_review_seen(state: State<'_, DbState>, key: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    // key 例: "snapshot_2025-Q1" / "annual_2024"
    if let Some(rest) = key.strip_prefix("snapshot_") {
        mira.execute(
            "INSERT OR REPLACE INTO mira_settings (key, value, value_type) VALUES ('last_snapshot_seen', ?1, 'text')",
            [rest],
        )
        .map_err(|e| {
            logging::log_error("startup", &format!("last_snapshot_seen 更新失敗: {e}"));
            "レビュー既読の保存に失敗しました".to_string()
        })?;
    } else if let Some(rest) = key.strip_prefix("annual_") {
        // L2 R2-15: "YYYY-annual" 形式で保存 (snapshot と同じ `YYYY-{period}` 構造)
        let value = format!("{rest}-annual");
        mira.execute(
            "INSERT OR REPLACE INTO mira_settings (key, value, value_type) VALUES ('last_annual_seen', ?1, 'text')",
            [value],
        )
        .map_err(|e| {
            logging::log_error("startup", &format!("last_annual_seen 更新失敗: {e}"));
            "レビュー既読の保存に失敗しました".to_string()
        })?;
    }
    Ok(())
}

fn query_pending_notifications(conn: &rusqlite::Connection) -> Vec<ScheduleNotification> {
    let now = chrono::Local::now();
    // L5 SQL-Opt-1: 半開区間 [today 00:00, today+8 00:00) で scheduled_at の生値を比較する。
    //   date(scheduled_at) BETWEEN は INDEX (idx_mira_scheduled_events_scheduled_at) が
    //   効かなかったため、SARGable な範囲比較に統一する。
    //   end は「7 日後を含む」ので翌々日まで広げる (today + 8 日の 00:00 未満)。
    let today_start = now.format("%Y-%m-%d 00:00:00").to_string();
    let end_exclusive = (now.date_naive() + chrono::Duration::days(8))
        .format("%Y-%m-%d 00:00:00")
        .to_string();

    // dismiss 済 source_ref を一度に取得して Rust 側で照合する (NOT IN サブクエリ排除)。
    // L5 SQL-Opt-5: 既存の週次パスと同じパターンに揃え、SQL 側の相関サブクエリを廃止する。
    //   SELECT 失敗時は空集合 (= dismiss なし扱い) とし、本来非表示の通知が一時的に出る方が
    //   通知喪失より安全という方針。
    let dismissed: std::collections::HashSet<String> = conn
        .prepare("SELECT source_ref FROM mira_dismissed_events")
        .and_then(|mut s| {
            s.query_map([], |row| row.get::<_, String>(0))
                .map(|it| it.filter_map(std::result::Result::ok).collect())
        })
        .unwrap_or_default();

    let mut result = Vec::new();

    // 1) 通常の予定 (非繰り返し): source_ref = "<id>"
    //    reminded=0 のものだけを対象とし、既に発火済みの予定は除外する。
    // L5 SQL-Opt-2: is_recurring / reminded は NOT NULL DEFAULT 0 なので COALESCE は不要。
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, scheduled_at, event_type FROM mira_scheduled_events
         WHERE notify_on_launch = 1
           AND is_recurring = 0
           AND reminded = 0
           AND scheduled_at >= ?1
           AND scheduled_at < ?2
         ORDER BY scheduled_at",
    ) {
        if let Ok(iter) = stmt.query_map([&today_start, &end_exclusive], |row| {
            let id: i64 = row.get(0)?;
            Ok(ScheduleNotification {
                id,
                title: row.get(1)?,
                scheduled_at: row.get(2)?,
                event_type: row.get(3)?,
                source_ref: id.to_string(),
            })
        }) {
            for n in iter.filter_map(std::result::Result::ok) {
                if dismissed.contains(&n.source_ref) {
                    continue;
                }
                result.push(n);
            }
        }
    }

    // 2) 週次繰り返し予定: source_ref = "<id>_YYYY-MM-DD" (次回発火日)
    // L5 SQL-Opt-2: is_recurring は NOT NULL DEFAULT 0、recurrence_kind は週次以外 NULL なので
    //   IS NOT DISTINCT FROM ではなく単純な = で十分 (NULL は = で外れる)。
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, title, scheduled_at, event_type FROM mira_scheduled_events
         WHERE notify_on_launch = 1
           AND is_recurring = 1
           AND recurrence_kind = 'weekly'",
    ) {
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
    // L4 R4-Err-4: 元実装は split 失敗をすべて silent (None) で握り潰していたため、
    //   想定外形式 (空文字 / "YYYY-MM-DD" 単体 / "T" のみ等) の混入を検知できなかった。
    //   各 fail 箇所で値を eprintln してから None に倒す。
    let Some(date_part) = scheduled_at.split([' ', 'T']).next() else {
        // L6 Log-7: scheduled_at は PII (予定情報) を含むため redact
        logging::log_error(
            "startup",
            &format!(
                "scheduled_at format invalid (no date part): {}",
                logging::redact(scheduled_at)
            ),
        );
        return None;
    };
    let Some(time_part) = scheduled_at.split([' ', 'T']).nth(1) else {
        logging::log_error(
            "startup",
            &format!(
                "scheduled_at format invalid (no time part): {}",
                logging::redact(scheduled_at)
            ),
        );
        return None;
    };

    let base_date = match chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
        Ok(d) => d,
        Err(e) => {
            logging::log_error(
                "startup",
                &format!(
                    "scheduled_at date parse failed: {} ({e})",
                    logging::redact(scheduled_at)
                ),
            );
            return None;
        }
    };
    let parts: Vec<&str> = time_part.split(':').collect();
    let Some(h_str) = parts.first() else {
        logging::log_error(
            "startup",
            &format!("scheduled_at time empty: {}", logging::redact(scheduled_at)),
        );
        return None;
    };
    let Ok(h) = h_str.parse::<u32>() else {
        logging::log_error(
            "startup",
            &format!(
                "scheduled_at hour parse failed: {}",
                logging::redact(scheduled_at)
            ),
        );
        return None;
    };
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

        // L2 R2-15: 新フォーマット "YYYY-annual" と旧フォーマット "YYYY" の両方を受け付ける。
        //   旧環境からの後方互換のため、片方でも一致したら既読扱いにする。
        let new_format = format!("{prev_year}-annual");
        if last_seen != prev_year && last_seen != new_format {
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
