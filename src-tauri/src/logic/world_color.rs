use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

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

pub fn generate_color(world_name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    world_name.hash(&mut hasher);
    let idx = (hasher.finish() % PALETTE.len() as u64) as usize;
    let (r, g, b) = PALETTE[idx];
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}
