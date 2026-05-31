//! 「めもきっと」チップ抽出ロジック。指定日のメモ・訪問・写真から特徴的なイベントを抽出して
//! フロントの付箋風 UI に表示するためのデータを組み立てる。

use rusqlite::Connection;
use serde::Serialize;

/// めもきっとのチップ 1 枚 (フロントの kitto-sticker と対応)。category は "world" または "person"
#[derive(Serialize)]
pub struct MemokittoChip {
    pub label: String,
    pub category: String,
}

/// 指定日に登場したワールド・同席ユーザーをチップ一覧として返す。
/// ワールドは最初に Join した時刻順、ユーザーは名前のアルファベット順で並べる
/// (フロントで worlds / people の 2 セクションに分けて表示する)。
pub fn extract(date: &str, stella: &Connection) -> Vec<MemokittoChip> {
    let mut chips = Vec::new();

    // 訪問ワールドを時系列順 (MIN(join_time) で重複排除しつつ最初の入室時刻でソート)
    if let Ok(mut stmt) = stella.prepare(
        "SELECT world_name
         FROM visit_summary
         WHERE date(join_time) = ?1
         GROUP BY world_name
         ORDER BY MIN(join_time)",
    ) {
        if let Ok(rows) = stmt.query_map([date], |row| row.get::<_, String>(0)) {
            chips.extend(
                rows.filter_map(std::result::Result::ok)
                    .map(|name| MemokittoChip {
                        label: name,
                        category: "world".into(),
                    }),
            );
        }
    }

    // 同席ユーザーを名前順 (人ごとに重複排除)。is_self=0 で自分自身を除外
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
            chips.extend(
                rows.filter_map(std::result::Result::ok)
                    .map(|name| MemokittoChip {
                        label: name,
                        category: "person".into(),
                    }),
            );
        }
    }

    chips
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// `extract` が参照する StellaRecord 側の最小スキーマを持つ in-memory DB を作る。
    fn stella_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE visit_summary (world_name TEXT NOT NULL, join_time TEXT NOT NULL);
            CREATE TABLE visits (id INTEGER PRIMARY KEY, join_time TEXT NOT NULL);
            CREATE TABLE with_users (visit_id INTEGER, vrchat_id TEXT, is_self INTEGER);
            CREATE TABLE find_users (vrchat_id TEXT PRIMARY KEY, account_name TEXT);
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn returns_empty_when_tables_are_missing() {
        // スキーマが無くても panic せず空を返す (prepare 失敗を握りつぶす設計)。
        let conn = Connection::open_in_memory().unwrap();
        assert!(extract("2026-05-31", &conn).is_empty());
    }

    #[test]
    fn worlds_come_first_ordered_by_first_visit() {
        let conn = stella_db();
        conn.execute(
            "INSERT INTO visit_summary (world_name, join_time) VALUES ('B World', '2026-05-31 20:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO visit_summary (world_name, join_time) VALUES ('A World', '2026-05-31 18:00:00')",
            [],
        )
        .unwrap();

        let chips = extract("2026-05-31", &conn);
        assert_eq!(chips.len(), 2);
        // 入室が早い A World が先。両方 world カテゴリ。
        assert_eq!(chips[0].label, "A World");
        assert_eq!(chips[0].category, "world");
        assert_eq!(chips[1].label, "B World");
    }

    #[test]
    fn people_follow_worlds_sorted_by_name_excluding_self() {
        let conn = stella_db();
        conn.execute(
            "INSERT INTO visit_summary (world_name, join_time) VALUES ('A World', '2026-05-31 18:00:00')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO visits (id, join_time) VALUES (1, '2026-05-31 18:00:00')",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "
            INSERT INTO find_users (vrchat_id, account_name) VALUES ('usr_b', 'Bob');
            INSERT INTO find_users (vrchat_id, account_name) VALUES ('usr_a', 'Alice');
            INSERT INTO find_users (vrchat_id, account_name) VALUES ('usr_me', 'Me');
            INSERT INTO with_users (visit_id, vrchat_id, is_self) VALUES (1, 'usr_b', 0);
            INSERT INTO with_users (visit_id, vrchat_id, is_self) VALUES (1, 'usr_a', 0);
            INSERT INTO with_users (visit_id, vrchat_id, is_self) VALUES (1, 'usr_me', 1);
            ",
        )
        .unwrap();

        let chips = extract("2026-05-31", &conn);
        // [world: A World, person: Alice, person: Bob] — 自分 (is_self=1) は除外。
        assert_eq!(chips.len(), 3);
        assert_eq!(chips[0].category, "world");
        assert_eq!(chips[1].label, "Alice");
        assert_eq!(chips[1].category, "person");
        assert_eq!(chips[2].label, "Bob");
        assert!(chips.iter().all(|c| c.label != "Me"));
    }

    #[test]
    fn other_dates_are_not_included() {
        let conn = stella_db();
        conn.execute(
            "INSERT INTO visit_summary (world_name, join_time) VALUES ('A World', '2026-05-30 18:00:00')",
            [],
        )
        .unwrap();
        assert!(extract("2026-05-31", &conn).is_empty());
    }
}
