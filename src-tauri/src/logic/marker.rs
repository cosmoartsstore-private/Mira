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

    for kind in [MarkerKind::Person, MarkerKind::World] {
        for (term, k) in &candidates {
            if *k != kind {
                continue;
            }
            if term.is_empty() {
                continue;
            }
            for (pos, _) in text.match_indices(term) {
                let range = (pos, pos + term.len());
                if !used.iter().any(|u| overlaps(*u, range)) {
                    used.push(range);
                    matches.push(MarkerMatch {
                        start: range.0,
                        end: range.1,
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
