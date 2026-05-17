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
