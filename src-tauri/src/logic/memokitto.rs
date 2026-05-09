use rusqlite::Connection;
use serde::Serialize;

/// メモ挿入用のチップ(ワールド名やユーザー名)
#[derive(Serialize)]
pub struct MemokittoChip {
    pub label: String,
    pub category: String,
}

/// 指定日の訪問ワールドと同席ユーザーをチップ一覧として抽出する
pub fn extract(date: &str, stella: &Connection) -> Vec<MemokittoChip> {
    let mut chips = Vec::new();

    // 訪問ワールドを時系列順に取得
    if let Ok(mut stmt) = stella.prepare(
        "SELECT world_name
         FROM visit_summary
         WHERE date(join_time) = ?1
         GROUP BY world_name
         ORDER BY MIN(join_time)",
    ) {
        if let Ok(rows) = stmt.query_map([date], |row| row.get::<_, String>(0)) {
            chips.extend(rows.filter_map(|r| r.ok()).map(|name| MemokittoChip {
                label: name,
                category: "world".into(),
            }));
        }
    }

    // 同席ユーザーを名前順に取得
    if let Ok(mut stmt) = stella.prepare(
        "SELECT fu.account_name
         FROM with_users wu
         JOIN find_users fu ON fu.vrchat_id = wu.vrchat_id
         JOIN visits v ON v.id = wu.visit_id
         WHERE wu.is_self = 0 AND date(v.join_time) = ?1
         GROUP BY fu.vrchat_id
         ORDER BY fu.account_name",
    ) {
        if let Ok(rows) = stmt.query_map([date], |row| row.get::<_, String>(0)) {
            chips.extend(rows.filter_map(|r| r.ok()).map(|name| MemokittoChip {
                label: name,
                category: "person".into(),
            }));
        }
    }

    chips
}
