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

    // L2 R2-3: `date(...)` ラッパは INDEX が効かないため、ISO 8601 TEXT の辞書順 = 時系列順
    // 特性を利用して半開区間 (`>= ? AND < ?`) で範囲検索する。終端は inclusive な
    // period_end (例 "2025-12-31") に「\u{FFFF}」相当の '~' を後付けすると桁数差で
    // 失敗するため、文字列に "z" を付けるだけで「YYYY-MM-DD HH:..」まで含み得る形にする。
    let period_end_exclusive = format!("{period_end}z");

    let event_count: i32 = mira
        .query_row(
            "SELECT COUNT(*) FROM mira_scheduled_events
             WHERE scheduled_at >= ?1 AND scheduled_at < ?2",
            rusqlite::params![period_start, period_end_exclusive],
            |row| row.get(0),
        )
        .unwrap_or(0);

    // L2 R2-8: メモ日数 / 文字数集計を SQL 集約に統合し、行ごとの取り出しを避ける。
    //   SQLite の length() は UTF-8 バイト数ベースだが、SUM(length(user_memo)) の値が
    //   1 期間あたり最大数万バイト程度に収まる前提で集約結果のみ Rust 側に取り出す。
    //   厳密な Unicode 文字数とはずれる (ASCII=1 / 日本語=3 byte) ため、ここでの値は
    //   「概算 byte 量」として扱う旨ラベル側に補足の余地を残す。
    let (memo_day_count, memo_char_total): (i32, i32) = mira
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(length(user_memo)), 0)
             FROM mira_journal_entries
             WHERE date >= ?1 AND date < ?2
               AND user_memo IS NOT NULL AND length(user_memo) > 0",
            rusqlite::params![period_start, period_end_exclusive],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map(|(d, c)| {
            (
                i32::try_from(d).unwrap_or(i32::MAX),
                i32::try_from(c).unwrap_or(i32::MAX),
            )
        })
        .unwrap_or((0, 0));

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
