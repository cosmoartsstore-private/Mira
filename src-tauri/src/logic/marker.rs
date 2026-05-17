//! メモ本文中からワールド名 / 人名にマッチする箇所を検出し、**Unicode スカラー (char) 単位**
//! で範囲を返す純粋ロジック。フロント (`Array.from(s).length` で算出) と Rust 全層をスカラー単位
//! に揃えるため、内部の byte 位置を `chars().count()` で変換する。
//!
//! L7-MarkerUnit: 旧版は `encode_utf16().count()` を用いて UTF-16 単位で返していたが、
//!   絵文字 (例: "🎉" = UTF-16 で 2, scalar で 1) でフロントとずれて
//!   `add_manual_marker` が範囲エラーを返す事例があったため、3 層 (`find_markers` /
//!   `add_manual_marker` 検証 / `save_day_memo` クリップ) すべてを Unicode scalar に統一する。

use serde::Serialize;

/// マーカーの種類。`world` と `person` で見た目の色が分かれる (CSS 側で `marker-underline[data-kind]` で分岐)
#[derive(Serialize, Clone, PartialEq)]
pub enum MarkerKind {
    World,
    Person,
}

/// メモ内で検出された 1 つのマッチ。
/// **start / end は Unicode スカラー (char) 単位の位置** で、フロント
/// `Array.from(memo).length` と直接比較できる。バイト → char 変換は `find_markers` 内で行う。
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
pub fn find_markers(text: &str, worlds: &[String], people: &[String]) -> Vec<MarkerMatch> {
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
    // L7-MarkerUnit: byte → Unicode scalar (char) 変換は `text[..pos].chars().count()`
    //   で行う。フロントの `Array.from(memo).length` と同じ単位になる。
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
                // バイトオフセットを Unicode scalar 単位に変換する (フロントと同単位)
                let start_char = text[..pos].chars().count();
                let end_char = text[..byte_end].chars().count();
                let range = (start_char, end_char);
                if !used.iter().any(|u| overlaps(*u, range)) {
                    used.push(range);
                    matches.push(MarkerMatch {
                        start: start_char,
                        end: end_char,
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

// 2 つの char 範囲 [a.0, a.1) と [b.0, b.1) が交差するかを判定する (半開区間)
fn overlaps(a: (usize, usize), b: (usize, usize)) -> bool {
    a.0 < b.1 && b.0 < a.1
}
