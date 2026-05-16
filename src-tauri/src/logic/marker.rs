//! メモ本文中からワールド名 / 人名にマッチする箇所を検出し、`UTF-16` コードユニット位置で
//! 範囲を返す純粋ロジック。フロントの DOM カーソル位置と整合させるため、内部の byte 位置を
//! `encode_utf16` 経由で UTF-16 単位に変換する。

use serde::Serialize;

/// マーカーの種類。`world` と `person` で見た目の色が分かれる (CSS 側で `marker-underline[data-kind]` で分岐)
#[derive(Serialize, Clone, PartialEq)]
pub enum MarkerKind {
    World,
    Person,
}

/// メモ内で検出された 1 つのマッチ。
/// **start / end は UTF-16 コードユニット位置** (JS 文字列インデックス互換)。
/// 旧版は UTF-8 byte 位置を返していたため日本語混じり文でズレていた。バイト → UTF-16 変換は `find_markers` 内で行う。
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

    // 人 → ワールドの順で 2 周回す。同位置に両カテゴリが当たり得るが、先勝ち (人) で固定する。
    // byte → UTF-16 変換は match_indices ループ内で `text[..pos].encode_utf16().count()` により直接行う。
    for kind in [MarkerKind::Person, MarkerKind::World] {
        for (term, k) in &candidates {
            if *k != kind {
                continue;
            }
            if term.is_empty() {
                continue;
            }
            for (pos, _) in text.match_indices(term) {
                let byte_end = pos + term.len();
                // バイトオフセットを UTF-16 単位に変換する (TS側が UTF-16 で扱うため)
                let start_utf16 = text[..pos].encode_utf16().count();
                let end_utf16 = text[..byte_end].encode_utf16().count();
                let range = (start_utf16, end_utf16);
                if !used.iter().any(|u| overlaps(*u, range)) {
                    used.push(range);
                    matches.push(MarkerMatch {
                        start: start_utf16,
                        end: end_utf16,
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
