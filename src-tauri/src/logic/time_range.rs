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
    // 終了は p95 を 2 時間後ろに伸ばす。p95 < p5 (深夜跨ぎ) なら +24 を加算してから 30 で頭打ち。
    //
    // L2 R2-21: 深夜跨ぎ判定の前提。
    //   StellaRecord の `visits.join_time` は UTC 文字列で格納されているため、上の SELECT で
    //   `'localtime'` 修飾子を付けて %H を取り出している。よって p5/p95 は **Local TZ 基準**の
    //   時 (0..23) であり、+24 後の表示時刻 (`HomePage` で h - 24 へ戻す) も Local 上の翌日扱い。
    //   サマータイム切替日は 1 時間ずれる可能性があるが、5/95% パーセンタイル統計は
    //   端 1 件のずれを十分吸収するため許容する。
    let end = if p95 >= p5 {
        (p95 + 2).min(30)
    } else {
        (p95 + 24 + 2).min(30)
    };

    (start, end)
}
