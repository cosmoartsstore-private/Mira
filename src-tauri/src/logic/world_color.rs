//! ワールド名からレーン用の決定論的なカラーパレット (12 色) を選ぶ純粋ロジック。
//! `world_id` ベースで色を `mira_world_colors` に保存することで、ワールド名が変わっても
//! 同じワールドに同じ色が当たり続けるよう設計されている (永続化は呼び出し側の責務)。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// レーン色のパレット (12 色)。RGB はディスプレイで隣同士でも見分けがつくよう手調整済み。
/// 各色はワールド名のハッシュから 1 つ選ばれ、ユーザーが色変更しない限り永続固定する。
const PALETTE: [(u8, u8, u8); 12] = [
    (200, 99, 58),   // dusk-orange
    (108, 138, 178), // muted blue
    (210, 138, 166), // dusk-pink
    (155, 201, 122), // soft green
    (155, 130, 178), // lavender
    (212, 154, 74),  // dusk-gold
    (139, 107, 155), // purple
    (90, 160, 148),  // teal
    (180, 120, 90),  // warm brown
    (120, 160, 140), // sage
    (170, 100, 130), // mauve
    (100, 140, 170), // steel blue
];

/// `world_name` から決定論的に "#rrggbb" 形式の色を生成する。
/// `DefaultHasher` は環境毎に異なる seed を持つが、同一プロセス内では同じ入力に同じ出力を返す。
/// 永続化は呼び出し側 (`journal::get_or_generate_world_color`) が `mira_world_colors` に保存する責務。
pub fn generate_color(world_name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    world_name.hash(&mut hasher);
    // PALETTE.len() == 12 のため剰余結果は常に 0..11 で usize に収まる
    #[allow(clippy::cast_possible_truncation)]
    let idx = (hasher.finish() % PALETTE.len() as u64) as usize;
    let (r, g, b) = PALETTE[idx];
    format!("#{r:02x}{g:02x}{b:02x}")
}
