use chrono::Datelike;
use serde::Serialize;
use tauri::State;

use crate::db::DbState;

/// 起動時に表示する予定通知の最小情報
#[derive(Serialize)]
pub struct ScheduleNotification {
    pub title: String,
    pub scheduled_at: String,
    pub event_type: String,
}

/// アプリ起動直後にフロントへ一括で返す初期状態
#[derive(Serialize)]
pub struct StartupInfo {
    pub stella_connected: bool,
    pub pending_notifications: Vec<ScheduleNotification>,
    /// 振り返り演出のトリガキー (例: "annual_2025", "snapshot_2026-Q1")。なければ None。
    pub pending_review: Option<String>,
    pub onboarding_needed: bool,
}

/// フロントが initApp 直後に呼ぶエントリ。STELLA 接続・予定・レビュー誘導・初回判定をまとめて返す。
#[tauri::command]
pub fn get_startup_info(state: State<'_, DbState>) -> Result<StartupInfo, String> {
    let stella_connected = state.stella.lock().unwrap().is_some();

    let mira = state.mira.lock().unwrap();

    // onboarding_completed が "0" (デフォルト) のままなら初回起動とみなす
    let onboarding_needed = mira
        .query_row(
            "SELECT value FROM mira_settings WHERE key = 'onboarding_completed'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "0".to_string())
        == "0";

    // 今日〜1週間以内に発火予定の通知 (起動時バナー表示用)
    let pending_notifications = get_pending_notifications(&mira);

    // 期 (Q1〜Q3) または年明け (annual) の振り返り未表示判定
    let pending_review = check_pending_review(&mira);

    Ok(StartupInfo {
        stella_connected,
        pending_notifications,
        pending_review,
        onboarding_needed,
    })
}

/// notify_on_launch=1 のうち今日〜+7 日に scheduled_at が入っているものを起動バナー用に返す
fn get_pending_notifications(
    conn: &rusqlite::Connection,
) -> Vec<ScheduleNotification> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let week_later = (chrono::Local::now() + chrono::Duration::days(7))
        .format("%Y-%m-%d")
        .to_string();

    let mut stmt = conn
        .prepare(
            "SELECT title, scheduled_at, event_type FROM mira_scheduled_events
             WHERE notify_on_launch = 1
               AND date(scheduled_at) BETWEEN ?1 AND ?2
             ORDER BY scheduled_at",
        )
        .unwrap();

    stmt.query_map([&today, &week_later], |row| {
        Ok(ScheduleNotification {
            title: row.get(0)?,
            scheduled_at: row.get(1)?,
            event_type: row.get(2)?,
        })
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
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
    let year = now.format("%Y").to_string();
    let month = now.month();

    // 1 月だけは前年 annual を未読なら出す
    if month == 1 {
        let prev_year = (now.year() - 1).to_string();
        let last_seen: String = conn
            .query_row(
                "SELECT value FROM mira_settings WHERE key = 'last_annual_seen'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_default();

        if last_seen != prev_year {
            return Some(format!("annual_{}", prev_year));
        }
    }

    // 期境界の翌月以降に Q1/Q2/Q3 サマリを表示する (Q1 は 4 月から表示、など)
    let quarter_key = match month {
        4..=6 => Some(format!("{}-Q1", year)),
        7..=9 => Some(format!("{}-Q2", year)),
        10..=12 => Some(format!("{}-Q3", year)),
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
            return Some(format!("snapshot_{}", qk));
        }
    }

    None
}
