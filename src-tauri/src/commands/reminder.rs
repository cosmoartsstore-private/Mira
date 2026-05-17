//! フロントエンドから 30 秒間隔で呼ばれるリマインダーポーリングコマンド。
//! `mira_scheduled_events` から発火時刻を迎えた予定を抽出し、通知済みフラグ (`reminded` /
//! `last_fired_at`) を立てて結果を返す。週次繰り返しと dismiss 履歴も考慮する。

use chrono::{Datelike, NaiveDateTime};
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::utils::logging;

/// リマインダー通知対象のイベント情報
#[derive(Serialize, Clone)]
pub struct ReminderEvent {
    pub id: i64,
    pub title: String,
    pub scheduled_at: String,
    pub event_type: String,
    pub minutes_until: i64,
}

/// L5 SQL-Opt-6: `julianday()` 演算は INDEX を完全に無効化するため、
///   `minutes_until` 計算を Rust 側に移動するヘルパ。
///   `scheduled_at` は "YYYY-MM-DD HH:MM:SS" を想定 (`normalize_scheduled_at` で保証済)。
///   parse 失敗時は 0 を返し、SQL 側でフィルタ条件は満たしている前提で表示する。
fn compute_minutes_until(scheduled_at: &str, now: &chrono::DateTime<chrono::Local>) -> i64 {
    use chrono::TimeZone;
    let Ok(naive) = NaiveDateTime::parse_from_str(scheduled_at, "%Y-%m-%d %H:%M:%S") else {
        // L6 Log-7: scheduled_at は予定情報を含むため redact
        logging::log_error(
            "reminder",
            &format!(
                "compute_minutes_until parse 失敗: {}",
                logging::redact(scheduled_at)
            ),
        );
        return 0;
    };
    let Some(dt) = chrono::Local.from_local_datetime(&naive).single() else {
        logging::log_warn(
            "reminder",
            &format!(
                "compute_minutes_until 曖昧時刻: {}",
                logging::redact(scheduled_at)
            ),
        );
        return 0;
    };
    (dt - *now).num_minutes()
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
///
/// 連続する SQL 操作を 1 トランザクションでまとめる構造上、行数が 100 を超えるため
/// `too_many_lines` は allow する (SQL リテラルが大半)。
#[allow(clippy::too_many_lines)]
#[tauri::command]
pub fn check_due_reminders(state: State<'_, DbState>) -> Result<Vec<ReminderEvent>, String> {
    let mut mira = crate::db::lock_mira(&state)?;
    // L2 R2-19: TZ 取り扱い方針 — `chrono::Local::now()` は呼出のたびに OS のローカル
    //   タイムゾーンを参照するため、夏時間切替や日付境界は呼出時点の最新 TZ で反映される。
    //   Windows の TZ 設定変更は process 起動中にプッシュ通知されない (`tzdata` キャッシュは
    //   chrono が PROCESS_TZ_DATA を持たないため毎回 SYSTEMTIME を引く) ため、
    //   ユーザーが起動中に TZ を変更した場合は再起動を推奨する旨を README で案内する。
    let now = chrono::Local::now();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let today_str = now.format("%Y-%m-%d").to_string();

    // `transaction()` は `&mut self` 必須で借用検査が効くため、後続の prepare/query_map
    // との二重トランザクション混入を機械的に弾ける (`unchecked_transaction()` 不採用)。
    let tx = mira.transaction().map_err(|e| {
        logging::log_error("reminder", &format!("transaction 開始失敗: {e}"));
        "リマインダー処理を開始できませんでした".to_string()
    })?;

    // dismiss 済 source_ref を一度に取得。取得に失敗した場合は dismiss 状態が
    // 不明なまま発火させると「dismiss したはずの予定」が再表示されてしまうため、
    // リマインダー処理自体を skip して次回ポーリングに委ねる (C7)。
    //
    // L2 R2-17: ここで取得した `dismissed` は tx 内スナップショットとして関数末尾まで使い回す。
    //   loop 内で再取得しないこと (再取得すると同じ tx 内で 2 回 SELECT してしまい、
    //   tx 中に他プロセスが書込んだ場合の整合性が崩れる)。tx.commit() までは一括処理。
    let dismissed: std::collections::HashSet<String> = tx
        .prepare("SELECT source_ref FROM mira_dismissed_events")
        .and_then(|mut s| {
            s.query_map([], |row| row.get::<_, String>(0))
                .map(|it| it.filter_map(std::result::Result::ok).collect())
        })
        .map_err(|e| {
            logging::log_error("reminder", &format!("dismissed 取得失敗: {e}"));
            "リマインダーの状態取得に失敗しました".to_string()
        })?;

    // 通常の予定 (非繰り返し)
    // stmt と query_map の戻り値 (MappedRows) は借用関係にあるため、必ず別 let に束縛し
    // ブロック式の末尾でドロップ順を明示する。
    // L5 SQL-Opt-6: SELECT 側の julianday/CAST/datetime ラッパは scheduled_at INDEX を
    //   壊すため撤廃。生値を取り出し、minutes_until は Rust 側で chrono から算出する。
    // L5 SQL-Opt-2: is_recurring は NOT NULL DEFAULT 0 が保証されているため COALESCE 不要。
    let mut stmt = tx
        .prepare(
            "SELECT id, title, scheduled_at, event_type
             FROM mira_scheduled_events
             WHERE reminded = 0
               AND is_recurring = 0
               AND (
                    (datetime(scheduled_at, '-' || remind_minutes_before || ' minutes') <= ?1
                     AND scheduled_at >= ?1)
                 OR (scheduled_at < ?1
                     AND scheduled_at >= datetime(?1, '-1 hour'))
               )",
        )
        .map_err(|e| {
            logging::log_error("reminder", &format!("通常予定 prepare 失敗: {e}"));
            "リマインダーの取得に失敗しました".to_string()
        })?;
    let rows = stmt
        .query_map([&now_str], |row| {
            let scheduled_at: String = row.get(2)?;
            let minutes_until = compute_minutes_until(&scheduled_at, &now);
            Ok(ReminderEvent {
                id: row.get(0)?,
                title: row.get(1)?,
                scheduled_at,
                event_type: row.get(3)?,
                minutes_until,
            })
        })
        .map_err(|e| {
            logging::log_error("reminder", &format!("通常予定 query_map 失敗: {e}"));
            "リマインダーの取得に失敗しました".to_string()
        })?;
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
            .map_err(|e| {
                logging::log_error("reminder", &format!("reminded 更新失敗 (id={}): {e}", r.id));
                "リマインダーの更新に失敗しました".to_string()
            })?;
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
            .map_err(|e| {
                logging::log_error(
                    "reminder",
                    &format!("last_fired_at 更新失敗 (id={}): {e}", r.id),
                );
                "リマインダーの更新に失敗しました".to_string()
            })?;
        if updated > 0 {
            accepted_recurring.push(r);
        }
    }
    reminders.extend(accepted_recurring);

    tx.commit().map_err(|e| {
        logging::log_error("reminder", &format!("commit 失敗: {e}"));
        "リマインダーの保存に失敗しました".to_string()
    })?;

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
    // L4 R4-Err-9: prepare/query_map 失敗を silent (空 Vec) で握り潰すと、
    //   週次予定が「実は SQL エラーで一切出ていない」状態が UI から不可視になる。
    //   現契約 (戻り値 Vec) を壊さず、最低限 eprintln で可視化する。
    //   将来的には Result<Vec, String> に昇格し、呼出側でユーザーに toast を出す方針。
    // L5 SQL-Opt-2: is_recurring は NOT NULL DEFAULT 0 / recurrence_kind は週次以外 NULL なので、
    //   = 比較で十分 (= NULL は常に外れる)。last_fired_at は NULL を許容する設計なので
    //   ここだけ COALESCE を残す (空文字との比較で「未発火」を表現)。
    let mut stmt = match mira.prepare(
        "SELECT id, title, scheduled_at, event_type, remind_minutes_before, COALESCE(last_fired_at, '')
         FROM mira_scheduled_events
         WHERE is_recurring = 1
           AND recurrence_kind = 'weekly'",
    ) {
        Ok(s) => s,
        Err(e) => {
            logging::log_error("reminder", &format!("collect_recurring_due prepare 失敗: {e}"));
            return Vec::new();
        }
    };

    let rows = match stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
        ))
    }) {
        Ok(r) => r,
        Err(e) => {
            logging::log_error(
                "reminder",
                &format!("collect_recurring_due query_map 失敗: {e}"),
            );
            return Vec::new();
        }
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
    // L2 R2-22: 元実装は split 失敗をすべて silent (None) で握り潰していたため、
    //   想定外形式の混入を検知できなかった。各 fail 箇所で値を eprintln する。
    let Some(date_part) = scheduled_at.split([' ', 'T']).next() else {
        // L6 Log-7: scheduled_at は予定 PII を含む可能性ありで redact
        logging::log_error(
            "reminder",
            &format!(
                "scheduled_at parse failed (no date part): {}",
                logging::redact(scheduled_at)
            ),
        );
        return None;
    };
    let Some(time_part) = scheduled_at.split([' ', 'T']).nth(1) else {
        logging::log_error(
            "reminder",
            &format!(
                "scheduled_at parse failed (no time part): {}",
                logging::redact(scheduled_at)
            ),
        );
        return None;
    };

    // scheduled_at の曜日を取得し、今日の曜日と異なれば発火対象外
    let base_date = match chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
        Ok(d) => d,
        Err(e) => {
            logging::log_error(
                "reminder",
                &format!(
                    "scheduled_at date parse failed: {} ({e})",
                    logging::redact(scheduled_at)
                ),
            );
            return None;
        }
    };
    if base_date.weekday() != now.weekday() {
        return None;
    }
    // base_date がまだ未来 (初回発火日が今日より先) なら、たとえ今日が同曜日でも発火しない
    if base_date > now.date_naive() {
        return None;
    }

    let parts: Vec<&str> = time_part.split(':').collect();
    let Some(h_str) = parts.first() else {
        logging::log_error(
            "reminder",
            &format!("scheduled_at time empty: {}", logging::redact(scheduled_at)),
        );
        return None;
    };
    let Ok(h) = h_str.parse::<u32>() else {
        logging::log_error(
            "reminder",
            &format!(
                "scheduled_at hour parse failed: {}",
                logging::redact(scheduled_at)
            ),
        );
        return None;
    };
    // L4 R4-Err-5: 元実装は minute/second の parse 失敗を `unwrap_or(0)` で握り潰しており、
    //   "08:XX:30" のような部分的に壊れた値が "08:00:30" として扱われ、
    //   ユーザーが意図しない時刻に発火していた可能性があった。
    //   `parts` に該当インデックスが存在する場合は parse 失敗を fail-fast で None 返す
    //   (省略形 "08" や "08:30" は引き続き許容、書かれている分だけ厳格に検証)。
    let m: u32 = match parts.get(1) {
        Some(s) => match s.parse::<u32>() {
            Ok(v) => v,
            Err(e) => {
                logging::log_error(
                    "reminder",
                    &format!(
                        "scheduled_at minute parse failed: {} ({e})",
                        logging::redact(scheduled_at)
                    ),
                );
                return None;
            }
        },
        None => 0,
    };
    let s: u32 = match parts.get(2) {
        Some(s) => match s.parse::<u32>() {
            Ok(v) => v,
            Err(e) => {
                logging::log_error(
                    "reminder",
                    &format!(
                        "scheduled_at second parse failed: {} ({e})",
                        logging::redact(scheduled_at)
                    ),
                );
                return None;
            }
        },
        None => 0,
    };
    let date = now.date_naive();
    let naive = date.and_hms_opt(h, m, s)?;
    chrono::Local.from_local_datetime(&naive).single()
}
