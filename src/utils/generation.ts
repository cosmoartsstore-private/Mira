// 非同期処理の世代カウンタユーティリティ (Loop 6 refactor)。
//
// HomePage の `loadGen` / `memoGen` のように、await を跨ぐ非同期ロード処理で
// 「自分の発火後に新しい発火が来たら自分の結果を破棄する」パターンを共通化する。
//
// 使い方:
//   const gen = createGeneration();
//   async function load() {
//     const my = gen.next();
//     const data = await fetch(...);
//     if (!gen.isCurrent(my)) return; // 後発がいたら描画を諦める
//     render(data);
//   }
//
// 設計メモ:
//   - 内部状態は単純な単調増加カウンタ (number)。
//     1 ページ表示中に Number.MAX_SAFE_INTEGER (≒ 9e15) を超える再ロードは現実的に発生しない。
//   - `next()` は副作用 (counter++) を伴うため、呼出毎にユニークなトークンを返す。
//   - `current()` は現在の世代を読むだけ。
//   - `isCurrent(g)` は `g === current()` の糖衣で、呼出側を簡潔に書けるようにする。

export interface Generation {
  next: () => number;
  current: () => number;
  isCurrent: (g: number) => boolean;
}

// 新しい世代カウンタを生成する。
// 戻り値はそのページ/コンポーネント内に保持し、async race のチェックに使う。
export function createGeneration(): Generation {
  let gen = 0;
  return {
    next: () => ++gen,
    current: () => gen,
    isCurrent: (g: number) => g === gen,
  };
}
