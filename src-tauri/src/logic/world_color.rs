//! ワールド名からレーン用の決定論的なカラーパレット (12 色) を選ぶ純粋ロジック。
//! `world_id` ベースで色を `mira_world_colors` に保存することで、ワールド名が変わっても
//! 同じワールドに同じ色が当たり続けるよう設計されている (永続化は呼び出し側の責務)。
//!
//! ハッシュは **プロセス間で決定論的** な FNV-1a を採用する。`std`/`collections`/`hash_map::DefaultHasher`
//! は `SipHash` で seed がプロセス起動毎にランダム化される (`DoS` 緩和目的) ため、
//! DB キャッシュミス時に再起動で色が変わるリスクがあった。FNV-1a 64-bit は依存ゼロで
//! 短文字列に対し均等性も実用十分。

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

/// FNV-1a 64-bit の初期 offset basis (公開定数)。
const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;

/// FNV-1a 64-bit の prime (公開定数)。
const FNV_PRIME: u64 = 0x100_0000_01b3;

/// 文字列を FNV-1a 64-bit でハッシュする。プロセス間で決定論的。
fn fnv1a_64(s: &str) -> u64 {
    let mut h = FNV_OFFSET_BASIS;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(FNV_PRIME);
    }
    h
}

/// `world_name` (実際には `world_id` を渡す) から決定論的に "#rrggbb" 形式の色を生成する。
/// 同じ入力に対しては OS / プロセスを跨いで同一の色を返す。
/// 永続化は呼び出し側 (`journal::get_or_generate_world_color`) が `mira_world_colors` に保存する責務。
pub fn generate_color(world_name: &str) -> String {
    // PALETTE.len() == 12 のため剰余結果は常に 0..11 で usize に収まる
    #[allow(clippy::cast_possible_truncation)]
    let idx = (fnv1a_64(world_name) % PALETTE.len() as u64) as usize;
    let (r, g, b) = PALETTE[idx];
    format!("#{r:02x}{g:02x}{b:02x}")
}
