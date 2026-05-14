use serde::Serialize;

/// マーカーの種類。world と person で見た目の色が分かれる (CSS 側で marker-underline[data-kind] で分岐)
#[derive(Serialize, Clone, PartialEq)]
pub enum MarkerKind {
    World,
    Person,
}

/// メモ内で検出された 1 つのマッチ。
/// **start / end は UTF-16 コードユニット位置** (JS 文字列インデックス互換)。
/// 旧版は UTF-8 byte 位置を返していたため日本語混じり文でズレていた。バイト → UTF-16 変換は find_markers 内で行う。
#[derive(Serialize)]
pub struct MarkerMatch {
    pub start: usize,
    pub end: usize,
    pub kind: MarkerKind,
    pub text: String,
}

/// メモ本文の中に登場するワールド名・ユーザー名を検出する。
///
/// マッチ規則:
/// 1. 候補語 (人 + ワールド) を「長い順」にソートし、長いマッチを優先採用する
///    (例: "ぷらねっと" の中に "ぷら" がある場合に短い方が先に消費されないように)
/// 2. 同一テキスト位置を二重に拾わないよう、採用済み byte 範囲 `used` と overlaps チェック
/// 3. 種類 (Person → World の順) でループを回し、同一範囲なら人を優先
///
/// 戻り値はマッチ位置 (start) 昇順でソート済み。
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

    // 長いマッチを先に確保するため byte 長で降順ソート (人/ワールド混在のまま)
    candidates.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

    let mut matches: Vec<MarkerMatch> = Vec::new();
    let mut used: Vec<(usize, usize)> = Vec::new();

    // フロントの JS 文字列は UTF-16 のため、返却前に byte 位置を UTF-16 単位に変換する
    let utf16_offsets = build_utf16_offsets(text);

    // 人 → ワールドの順で 2 周回す。同位置に両カテゴリが当たり得るが、先勝ち (人) で固定する。
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

// 2 つの byte 範囲 [a.0, a.1) と [b.0, b.1) が交差するかを判定する (半開区間)
fn overlaps(a: (usize, usize), b: (usize, usize)) -> bool {
    a.0 < b.1 && b.0 < a.1
}

// 文字列の各 char 境界における (byte_offset, utf16_offset) をすべて並べた変換表を作る。
// 末尾には文字列終端の (text.len(), total_utf16_len) も入れて、文字列末尾 byte 位置も解決できるようにする。
// utf16 単位は BMP=1, サロゲートペア対応文字 (絵文字など) =2 が混在し得る。
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

// 任意の byte 位置を UTF-16 オフセットに変換する。境界に当たれば二分探索でその値、
// 中間に当たる (multi-byte 文字内側) ならその直前の境界の UTF-16 オフセットを返す。
// match_indices の結果は必ず char 境界なので通常 Err パスには来ない。
fn utf16_offset_at(offsets: &[(usize, usize)], byte_pos: usize) -> usize {
    match offsets.binary_search_by_key(&byte_pos, |&(b, _)| b) {
        Ok(i) => offsets[i].1,
        Err(i) => offsets.get(i.saturating_sub(1)).map(|&(_, u)| u).unwrap_or(0),
    }
}
