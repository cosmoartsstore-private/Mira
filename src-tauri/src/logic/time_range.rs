use rusqlite::Connection;

pub fn detect_activity_range(conn: &Connection) -> (u8, u8) {
    let mut stmt = match conn.prepare(
        "SELECT CAST(strftime('%H', join_time) AS INTEGER) AS hour
         FROM visits
         WHERE join_time >= date('now', '-30 days')",
    ) {
        Ok(s) => s,
        Err(_) => return (12, 26),
    };

    let rows = match stmt.query_map([], |row| row.get::<_, u8>(0)) {
        Ok(r) => r,
        Err(_) => return (12, 26),
    };

    let mut hours: Vec<u8> = rows.filter_map(|r| r.ok()).collect();

    if hours.is_empty() {
        return (12, 26);
    }

    hours.sort();

    let len = hours.len();
    let p5 = hours[len * 5 / 100];
    let p95 = hours[(len * 95 / 100).min(len - 1)];

    let start = p5.saturating_sub(1);
    let end = if p95 >= p5 {
        (p95 + 2).min(30)
    } else {
        (p95 + 24 + 2).min(30)
    };

    (start, end)
}
