use serde::Serialize;

#[derive(Serialize, Clone, PartialEq)]
pub enum MarkerKind {
    World,
    Person,
}

#[derive(Serialize)]
pub struct MarkerMatch {
    pub start: usize,
    pub end: usize,
    pub kind: MarkerKind,
    pub text: String,
}

pub fn find_markers(
    text: &str,
    worlds: &[String],
    people: &[String],
) -> Vec<MarkerMatch> {
    let mut candidates: Vec<(&str, MarkerKind)> = Vec::new();
    for p in people {
        candidates.push((p.as_str(), MarkerKind::Person));
    }
    for w in worlds {
        candidates.push((w.as_str(), MarkerKind::World));
    }

    candidates.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    let mut matches: Vec<MarkerMatch> = Vec::new();
    let mut used: Vec<(usize, usize)> = Vec::new();

    // Frontend strings are UTF-16; marker positions must be in UTF-16 units, not UTF-8 bytes
    let utf16_offsets = build_utf16_offsets(text);

    for kind in [MarkerKind::Person, MarkerKind::World] {
        for (term, k) in &candidates {
            if *k != kind {
                continue;
            }
            if term.is_empty() {
                continue;
            }
            for (pos, _) in text.match_indices(term) {
                let byte_range = (pos, pos + term.len());
                if !used.iter().any(|u| overlaps(*u, byte_range)) {
                    used.push(byte_range);
                    let start_u16 = utf16_offset_at(&utf16_offsets, byte_range.0);
                    let end_u16 = utf16_offset_at(&utf16_offsets, byte_range.1);
                    matches.push(MarkerMatch {
                        start: start_u16,
                        end: end_u16,
                        kind: kind.clone(),
                        text: term.to_string(),
                    });
                }
            }
        }
    }

    matches.sort_by_key(|m| m.start);
    matches
}

fn overlaps(a: (usize, usize), b: (usize, usize)) -> bool {
    a.0 < b.1 && b.0 < a.1
}

// (byte_offset, utf16_offset) pairs at every char boundary, plus the final length.
fn build_utf16_offsets(s: &str) -> Vec<(usize, usize)> {
    let mut offsets = Vec::with_capacity(s.len() + 1);
    let mut u16_count = 0;
    for (byte_idx, ch) in s.char_indices() {
        offsets.push((byte_idx, u16_count));
        u16_count += ch.len_utf16();
    }
    offsets.push((s.len(), u16_count));
    offsets
}

fn utf16_offset_at(offsets: &[(usize, usize)], byte_pos: usize) -> usize {
    match offsets.binary_search_by_key(&byte_pos, |&(b, _)| b) {
        Ok(i) => offsets[i].1,
        Err(i) => offsets.get(i.saturating_sub(1)).map(|&(_, u)| u).unwrap_or(0),
    }
}
