import { activeTab } from "../state/store";
import type { TabId } from "../state/types";

// 上部ナビゲーションバーを構築する。
// activeTab ストアを購読してアクティブな見た目を切り替え、クリックで activeTab.set する。
// debug タブは DEV ビルドでのみ表示。
export function Navbar(): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "navbar";

  const logo = document.createElement("div");
  logo.className = "navbar-logo";
  logo.textContent = "Mira";

  const tabs = document.createElement("div");
  tabs.className = "navbar-tabs";
  // a11y: タブパターン (WAI-ARIA Authoring Practices)。role=tablist にして子は role=tab。
  // aria-controls はページ側の id="page-{tab}" を指す (各ページ root の id 付与は別所要件)。
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "メインナビゲーション");

  const tabDefs: { id: TabId; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "calendar", label: "Calendar" },
    { id: "settings", label: "Settings" },
    ...(import.meta.env.DEV ? [{ id: "debug" as TabId, label: "Debug" }] : []),
  ];

  // L6 D-UX-A11y-1: タブの DOM 順序と矢印キー操作のため、id 配列を別途保持する。
  // 後段の keydown ハンドラから直接 indexOf するため、外側スコープに上げておく。
  const tabIds: TabId[] = tabDefs.map((d) => d.id);

  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.className = "navbar-tab";
    btn.dataset.tab = def.id;
    btn.textContent = def.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", `page-${def.id}`);
    // 初期 aria-selected は false で揃え、購読側で activeTab に応じて切り替える
    btn.setAttribute("aria-selected", "false");
    // a11y: WAI-ARIA Tab Panel パターン準拠で、選択中タブのみ Tab フォーカス可能にする (roving tabindex)。
    // 初期値は全て -1 で、subscribeImmediate 内で active な 1 つだけ 0 に上げる。
    btn.setAttribute("tabindex", "-1");
    btn.addEventListener("click", () => activeTab.set(def.id));
    tabs.appendChild(btn);
  }

  // L6 D-UX-A11y-1: 左右矢印キーでタブ切替を行う (WAI-ARIA Tab Panel パターン)。
  //   - ←: 1 つ前のタブ (端は wrap して最後尾へ)
  //   - →: 1 つ次のタブ (端は wrap して先頭へ)
  //   - Home: 先頭タブ / End: 最終タブ
  //   activeTab.set 経由で aria-selected と active クラスが反映され、合わせて
  //   subscribeImmediate ハンドラ内で該当タブへフォーカスを移す。
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    const current = activeTab.get();
    const idx = tabIds.indexOf(current);
    if (idx < 0) return;
    let nextIdx: number;
    if (e.key === "ArrowLeft") {
      nextIdx = (idx - 1 + tabIds.length) % tabIds.length;
    } else if (e.key === "ArrowRight") {
      nextIdx = (idx + 1) % tabIds.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else {
      nextIdx = tabIds.length - 1;
    }
    const next = tabIds[nextIdx];
    if (next !== current) activeTab.set(next);
  });

  nav.appendChild(logo);
  nav.appendChild(tabs);

  /**
   * ナビバーはアプリ生存中ずっと存在し、アンマウントされない。そのため返却される
   * unsubscribe 関数は意図的に破棄している (void 演算子で「戻り値を捨てる」明示)。
   * subscribeImmediate で登録と同時に現在値を 1 度発火させ、初期 active 状態の付与と
   * 後続の変更購読をまとめて行う (activeTab.get() の二重呼び出し回避)。
   *
   * L6 D-UX-A11y-1: roving tabindex を維持するため、active タブだけ tabindex=0 にして
   *   他は -1 に戻す。矢印キー切替時に直前のフォーカスタブから次のタブへフォーカスを
   *   移すために、変更検知時 (prev !== tab) のみ focus() を呼ぶ (初回 mount 時に
   *   勝手にナビバーへフォーカスが移らないよう、prev === tab の初回はフォーカス操作を行わない)。
   */
  void activeTab.subscribeImmediate((tab, prev) => {
    tabs.querySelectorAll(".navbar-tab").forEach((el) => {
      const isActive = el.getAttribute("data-tab") === tab;
      (el as HTMLElement).classList.toggle("active", isActive);
      // a11y: aria-selected と tabindex を視覚状態と同期させる (roving tabindex)
      (el as HTMLElement).setAttribute("aria-selected", isActive ? "true" : "false");
      (el as HTMLElement).setAttribute("tabindex", isActive ? "0" : "-1");
    });
    // 初回 (prev === tab) はナビバーにフォーカスを奪わない。キー操作で切替えた時のみ
    // 次のタブへフォーカスを移して連続矢印キー操作が成立するようにする。
    if (prev !== tab) {
      const next = tabs.querySelector<HTMLElement>(`.navbar-tab[data-tab="${tab}"]`);
      // ナビバー内に既にフォーカスがある時だけ移動する (他要素のフォーカスを奪わない)。
      // 例: ページ内のテキストエリアにフォーカス中はそちらを優先する。
      if (next && tabs.contains(document.activeElement)) {
        next.focus();
      }
    }
  });

  return nav;
}
