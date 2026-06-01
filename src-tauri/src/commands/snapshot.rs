//! 年次レビュー / 四半期スナップショットの集計データを返す Tauri コマンド。
//! `pending_review` キー (`annual_YYYY` / `snapshot_YYYY-Qn`) から対象期間を決定し、
//! 該当期間の予定数とメモ統計 (日数・総文字数) を返す。

use serde::Serialize;
use tauri::State;

use crate::db::DbState;

/// スナップショット集計結果
#[derive(Serialize)]
pub struct SnapshotSummary {
    pub key: String,
    pub label: String,
    pub period_start: String,
    pub period_end: String,
    pub event_count: i32,
    pub memo_day_count: i32,
    pub memo_char_total: i32,
}

/// `pending_review` キーから集計期間を決定し、その期間の予定/メモ統計を返す
///
/// 対応キー:
///   - `annual_YYYY`       => YYYY-01-01 〜 YYYY-12-31
///   - `snapshot_YYYY-Qn`  => 該当 Q の 3 ヶ月 (Q1=4-6, Q2=7-9, Q3=10-12, Q4=1-3)
#[tauri::command]
pub fn get_snapshot_summary(
    state: State<'_, DbState>,
    key: String,
) -> Result<SnapshotSummary, String> {
    let (period_start, period_end, label) =
        parse_key(&key).ok_or_else(|| "unsupported key".to_string())?;

    let mira = crate::db::lock_mira(&state)?;

    let event_count: i32 = mira
        .query_row(
            "SELECT COUNT(*) FROM mira_scheduled_events
             WHERE date(scheduled_at) BETWEEN ?1 AND ?2",
            rusqlite::params![period_start, period_end],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let memo_day_count: i32 = mira
        .query_row(
            "SELECT COUNT(*) FROM mira_journal_entries
             WHERE date(date) BETWEEN ?1 AND ?2
               AND user_memo IS NOT NULL AND length(user_memo) > 0",
            rusqlite::params![period_start, period_end],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // SQLite の length() は UTF-8 バイト数を返すため、Rust 側で Unicode 文字数を集計する
    let memo_char_total: i32 = {
        let mut stmt = mira
            .prepare(
                "SELECT user_memo FROM mira_journal_entries
                 WHERE date(date) BETWEEN ?1 AND ?2
                   AND user_memo IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(rusqlite::params![period_start, period_end], |row| {
                row.get::<_, Option<String>>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut total: usize = 0;
        for r in rows {
            if let Ok(Some(s)) = r {
                total = total.saturating_add(s.chars().count());
            }
        }
        i32::try_from(total).unwrap_or(i32::MAX)
    };

    Ok(SnapshotSummary {
        key,
        label,
        period_start,
        period_end,
        event_count,
        memo_day_count,
        memo_char_total,
    })
}

/// `pending_review` キーをパースし (start, end, ラベル) を返す
fn parse_key(key: &str) -> Option<(String, String, String)> {
    if let Some(rest) = key.strip_prefix("annual_") {
        let year: i32 = rest.parse().ok()?;
        return Some((
            format!("{year:04}-01-01"),
            format!("{year:04}-12-31"),
            format!("{year}年 年間レビュー"),
        ));
    }
    if let Some(rest) = key.strip_prefix("snapshot_") {
        // 形式: YYYY-Qn
        let parts: Vec<&str> = rest.splitn(2, '-').collect();
        if parts.len() != 2 {
            return None;
        }
        let year: i32 = parts[0].parse().ok()?;
        let q = parts[1]
            .strip_prefix('Q')
            .or_else(|| parts[1].strip_prefix('q'))?;
        let qn: u8 = q.parse().ok()?;
        let (start_m, end_m, end_day) = match qn {
            1 => (4, 6, 30),
            2 => (7, 9, 30),
            3 => (10, 12, 31),
            4 => (1, 3, 31),
            _ => return None,
        };
        return Some((
            format!("{year:04}-{start_m:02}-01"),
            format!("{year:04}-{end_m:02}-{end_day:02}"),
            // ユーザー認識のため月範囲をラベルに併記する
            format!("{year}年 Q{qn} スナップショット ({start_m}月-{end_m}月)"),
        ));
    }
    None
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_key_annual() {
        assert_eq!(
            parse_key("annual_2025"),
            Some((
                "2025-01-01".into(),
                "2025-12-31".into(),
                "2025年 年間レビュー".into()
            ))
        );
    }

    #[test]
    fn parse_key_quarters() {
        let (s, e, _) = parse_key("snapshot_2025-Q1").unwrap();
        assert_eq!((s.as_str(), e.as_str()), ("2025-04-01", "2025-06-30"));
        // Q4 は会計四半期で 1-3 月にマップされる
        let (s4, e4, _) = parse_key("snapshot_2025-Q4").unwrap();
        assert_eq!((s4.as_str(), e4.as_str()), ("2025-01-01", "2025-03-31"));
        // 小文字 q も許容
        assert!(parse_key("snapshot_2025-q2").is_some());
    }

    #[test]
    fn parse_key_rejects_invalid() {
        assert!(parse_key("snapshot_2025-Q5").is_none());
        assert!(parse_key("snapshot_2025").is_none());
        assert!(parse_key("annual_abc").is_none());
        assert!(parse_key("foo").is_none());
    }
}
