// モーダル/オーバーレイ用フォーカストラップ。
// open 時に focusable 要素を抽出し、最初/最後で Tab/Shift+Tab を循環させる。
// 戻り値は解除関数。close 時に必ず呼び出して keydown ハンドラと focus 復元を行う。

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface FocusTrapHandle {
  release: () => void;
}

// container 内に Tab フォーカスを閉じ込める。
// initialFocus 未指定時は最初の focusable 要素にフォーカスを当てる。
// release 時には呼び出し前のアクティブ要素にフォーカスを戻す。
export function trapFocus(container: HTMLElement, initialFocus?: HTMLElement): FocusTrapHandle {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const getFocusable = (): HTMLElement[] => {
    return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
    );
  };

  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    if (focusable.length === 0) {
      // 操作可能要素が一切なければ Tab 自体を無効化してフォーカスを container 外へ逃さない
      e.preventDefault();
      return;
    }
    // length >= 1 を直上で保証しているので、添字アクセスは null/undefined にならない。
    // ただし lib に ES2022.Array を含めていない都合上 `.at()` は型エラーになるため、
    // 旧来の `length-1` 添字アクセスを採用し、prefer-at は局所抑制する。
    const first = focusable[0];
    // eslint-disable-next-line unicorn/prefer-at
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener("keydown", keyHandler);

  // 初期フォーカス: 指定なしなら最初の focusable を選ぶ。
  // focusable が 0 件のケースもあり得るので長さチェックで分岐する (添字アクセスを使う前提)。
  let target: HTMLElement | undefined = initialFocus;
  if (target === undefined) {
    const focusable = getFocusable();
    if (focusable.length > 0) {
      target = focusable[0];
    }
  }
  if (target !== undefined) {
    const focusTarget = target;
    // requestAnimationFrame で DOM 反映後にフォーカス (transition との競合を避ける)
    requestAnimationFrame(() => focusTarget.focus());
  }

  return {
    release: () => {
      document.removeEventListener("keydown", keyHandler);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    },
  };
}

// overlay 表示中に body 内の他要素を inert 化する補助。
// 戻り値の release で元に戻す。実装簡易化のため #app などのルート要素を inert にし、
// overlay 自身はその外側 (= document.body 直下) に残すことでアクセス可能にする。
export function inertBackground(excludeRoots: HTMLElement[] = []): { release: () => void } {
  const toMark: HTMLElement[] = [];
  // body 直下の要素のうち、除外対象でないものに inert を付与する。
  // overlay は document.body.appendChild で body 直下に配置されるため、
  // overlay を excludeRoots に渡せばトラップ対象から外せる。
  Array.from(document.body.children).forEach((child) => {
    if (!(child instanceof HTMLElement)) return;
    if (excludeRoots.includes(child)) return;
    if (child.hasAttribute("inert")) return; // 二重付与回避
    child.setAttribute("inert", "");
    child.setAttribute("aria-hidden", "true");
    toMark.push(child);
  });

  return {
    release: () => {
      toMark.forEach((el) => {
        el.removeAttribute("inert");
        el.removeAttribute("aria-hidden");
      });
    },
  };
}
