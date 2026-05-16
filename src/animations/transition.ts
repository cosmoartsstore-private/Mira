// ページ遷移時のスライドカバー演出。
// transitionGen は世代カウンタで、遷移中に別の遷移が割り込んだ場合に古い await を破棄するのに使う。
// activeAnimations は新規遷移開始時に進行中のアニメをまとめて cancel() するため。
let transitionGen = 0;
let activeAnimations: Animation[] = [];

// 右からカバーをスライドイン → ページ差替コールバック → 左へスライドアウト、の3フェーズ。
// 各 await 後に gen 比較を行い、古い遷移であれば早期 return して二重実行を防ぐ。
export async function playTransition(destination: string, onCovered: () => void): Promise<void> {
  const cover = document.getElementById("transition-cover");
  if (!cover) {
    onCovered();
    return;
  }

  // 進行中の遷移があれば cancel（=Animation.finished が reject → catch で握りつぶす）
  for (const a of activeAnimations) a.cancel();
  activeAnimations = [];
  const gen = ++transitionGen;

  const label = cover.querySelector(".transition-label")!;
  const content = cover.querySelector<HTMLElement>(".transition-content")!;

  // 初期位置（画面右外）にリセット
  cover.style.transform = "translateX(100%)";
  cover.style.pointerEvents = "none";
  content.style.opacity = "1";

  label.textContent = `— ${capitalize(destination)} —`;
  cover.style.pointerEvents = "auto";

  try {
    // Phase 1: 右からスライドインしてビューを覆う
    cover.style.transform = "translateX(0%)";
    const slideIn = cover.animate(
      [{ transform: "translateX(100%)" }, { transform: "translateX(0%)" }],
      { duration: 380, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
    );
    activeAnimations.push(slideIn);
    await slideIn.finished;
    if (gen !== transitionGen) return;

    // 画面が完全に隠れている間にページを差し替え（チラつき防止）
    onCovered();

    // 新ページが描画され落ち着くまで保持
    await delay(400);
    if (gen !== transitionGen) return;

    // Phase 3: 左へ抜けてビューを露出
    const slideOut = cover.animate(
      [{ transform: "translateX(0%)" }, { transform: "translateX(-100%)" }],
      { duration: 380, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
    );
    activeAnimations.push(slideOut);

    // クリックでアウトを早送り（once: true なので解除は不要）
    const skipHandler = (): void => slideOut.finish();
    cover.addEventListener("pointerdown", skipHandler, { once: true });

    await slideOut.finished;
    cover.removeEventListener("pointerdown", skipHandler);
    if (gen !== transitionGen) return;

    // 次回用に右外へ戻す
    activeAnimations = [];
    cover.style.transform = "translateX(100%)";
    cover.style.pointerEvents = "none";
  } catch {
    // 新規遷移に cancel された場合の Animation.finished reject はここで吸収
  }
}

// 先頭1文字を大文字化（タブ名表示用）
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// 指定ミリ秒待つだけの Promise
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
