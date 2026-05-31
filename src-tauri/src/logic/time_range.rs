//! 週レーン描画の表示時間帯を直近 30 日の `visits.join_time` 分布から自動推定する純粋ロジック。
//! `StellaRecord` DB の `visits` テーブルを読み取り、5/95 パーセンタイル基準で `hour_start`/`hour_end` を返す。

use rusqlite::Connection;

/// レーン描画の表示時間帯 (`hour_start`, `hour_end`) を直近 30 日の活動から自動推定する。
///
/// アルゴリズム:
/// 1. 直近 30 日の `visits.join_time` から `%H` 整数 (0..23) を全て取り出す
/// 2. ソートして 5 パーセンタイル (p5) と 95 パーセンタイル (p95) の時刻を求める
/// 3. 開始は p5 の 1 時間前、終了は p95 の 2 時間後 (深夜跨ぎは +24 して 30 で頭打ち)
///
/// データが取れない/空の時は `VRChat` 利用者にありがちな夕方〜深夜帯 (12..26) を既定値とする。
/// p95 が p5 を下回るのは「日付を跨いで遊んでいる」ケースで、+24 して翌日の時刻として扱う。
/// `hour_end` は `26` のように 24 を越え得る (`HomePage` 側で displayHour = h - 24 で 0..23 に丸める)。
pub fn detect_activity_range(conn: &Connection) -> (u8, u8) {
    // R2-M-10: visits.join_time は UTC で格納されている可能性が高いため、
    // 'localtime' 修飾子を付けてローカル時刻の時間帯で集計する。
    let Ok(mut stmt) = conn.prepare(
        "SELECT CAST(strftime('%H', join_time, 'localtime') AS INTEGER) AS hour
         FROM visits
         WHERE join_time >= date('now', '-30 days', 'localtime')",
    ) else {
        return (12, 26);
    };

    let Ok(rows) = stmt.query_map([], |row| row.get::<_, u8>(0)) else {
        return (12, 26);
    };

    let mut hours: Vec<u8> = rows.filter_map(std::result::Result::ok).collect();

    if hours.is_empty() {
        return (12, 26);
    }

    hours.sort_unstable();

    let len = hours.len();
    // 整数除算なので少サンプル時は p5=hours[0] になる。これは「最も早い時刻」と同義で許容範囲。
    let p5 = hours[len * 5 / 100];
    let p95 = hours[(len * 95 / 100).min(len - 1)];

    // 開始は p5 を 1 時間早めて余白を取る (saturating_sub で 0 未満防止)
    let start = p5.saturating_sub(1);
    // 終了は p95 を 2 時間後ろに伸ばす。p95 < p5 (深夜跨ぎ) なら +24 を加算してから 30 で頭打ち
    let end = if p95 >= p5 {
        (p95 + 2).min(30)
    } else {
        (p95 + 24 + 2).min(30)
    };

    (start, end)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const DEFAULT_RANGE: (u8, u8) = (12, 26);

    /// visits テーブルだけを持つ空の in-memory DB を作る。
    fn empty_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE visits (id INTEGER PRIMARY KEY, join_time TEXT NOT NULL);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn falls_back_to_default_when_table_missing() {
        // visits テーブルが無いと prepare が失敗し、既定の夕方〜深夜帯を返す。
        let conn = Connection::open_in_memory().unwrap();
        assert_eq!(detect_activity_range(&conn), DEFAULT_RANGE);
    }

    #[test]
    fn falls_back_to_default_when_no_recent_rows() {
        let conn = empty_db();
        assert_eq!(detect_activity_range(&conn), DEFAULT_RANGE);
    }

    #[test]
    fn ignores_rows_older_than_30_days() {
        let conn = empty_db();
        // 1 年前の訪問は集計対象外 → 既定値のまま。
        conn.execute(
            "INSERT INTO visits (join_time) VALUES (datetime('now', '-400 days', 'localtime'))",
            [],
        )
        .unwrap();
        assert_eq!(detect_activity_range(&conn), DEFAULT_RANGE);
    }

    #[test]
    fn recent_activity_produces_a_bounded_window() {
        let conn = empty_db();
        // 直近の訪問を複数投入する。具体的な時刻は localtime 変換でズレ得るため、
        // ここでは「返り値が定義域の不変条件を満たす」ことを検証する。
        for offset in 0..20 {
            conn.execute(
                "INSERT INTO visits (join_time) VALUES (datetime('now', ?1, 'localtime'))",
                [format!("-{offset} hours")],
            )
            .unwrap();
        }
        let (start, end) = detect_activity_range(&conn);
        assert!(start <= 23, "start hour must be a valid clock hour");
        assert!(end <= 30, "end is capped at 30 (24h + late-night margin)");
        assert!(start < end, "start must precede end");
    }
}
