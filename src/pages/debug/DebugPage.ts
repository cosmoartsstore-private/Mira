import { currentWeekStart, focusedDate, currentMonth, settings, stellaConnected, activeTab, Subscriptions } from "../../state/store";
import { playSummaryAnimation } from "../../animations/summary";
import { playSnapshot } from "../../animations/snapshot";
import { getWeekLaneData, getDayFocusData, getMonthData, getStartupInfo, getSettings } from "../../api/commands";

// 開発専用ページ。Navbar から DEV ビルド時のみ到達可能。
// ストア状態の可視化・各 Tauri コマンドの単発実行・演出の再生確認をここに集約している。
export function DebugPage(subs: Subscriptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "debug-page";

  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>Debug</h1><span class="sub">開発用パネル</span>`;
  container.appendChild(pageHead);

  // State section
  const stateSection = createSection("Store State");
  const stateOutput = document.createElement("pre");
  stateOutput.className = "debug-output";
  stateSection.appendChild(stateOutput);
  container.appendChild(stateSection);

  // Store State セクションに現在のストア値を JSON で書き出す（購読のたびに再計算）
  function refreshState(): void {
    stateOutput.textContent = JSON.stringify({
      activeTab: activeTab.get(),
      stellaConnected: stellaConnected.get(),
      currentWeekStart: currentWeekStart.get(),
      focusedDate: focusedDate.get(),
      currentMonth: currentMonth.get(),
      settings: settings.get(),
    }, null, 2);
  }

  refreshState();
  subs.add(activeTab.subscribe(refreshState));
  subs.add(stellaConnected.subscribe(refreshState));
  subs.add(currentWeekStart.subscribe(refreshState));
  subs.add(focusedDate.subscribe(refreshState));
  subs.add(settings.subscribe(refreshState));

  // API test section
  const apiSection = createSection("API Commands");
  const apiOutput = document.createElement("pre");
  apiOutput.className = "debug-output";
  apiOutput.textContent = "コマンドを実行してください";

  const btnRow = document.createElement("div");
  btnRow.className = "debug-btn-row";

  btnRow.appendChild(createBtn("getStartupInfo", async () => {
    try {
      const r = await getStartupInfo();
      apiOutput.textContent = JSON.stringify(r, null, 2);
    } catch (e) { apiOutput.textContent = `Error: ${e}`; }
  }));

  btnRow.appendChild(createBtn("getSettings", async () => {
    try {
      const r = await getSettings();
      apiOutput.textContent = JSON.stringify(r, null, 2);
    } catch (e) { apiOutput.textContent = `Error: ${e}`; }
  }));

  btnRow.appendChild(createBtn("getWeekLaneData", async () => {
    try {
      const r = await getWeekLaneData(currentWeekStart.get());
      apiOutput.textContent = JSON.stringify(r, null, 2);
    } catch (e) { apiOutput.textContent = `Error: ${e}`; }
  }));

  btnRow.appendChild(createBtn("getMonthData", async () => {
    try {
      const { year, month } = currentMonth.get();
      const r = await getMonthData(year, month);
      apiOutput.textContent = JSON.stringify(r, null, 2);
    } catch (e) { apiOutput.textContent = `Error: ${e}`; }
  }));

  btnRow.appendChild(createBtn("getDayFocusData (today)", async () => {
    try {
      const today = new Date();
      const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const r = await getDayFocusData(d);
      apiOutput.textContent = JSON.stringify(r, null, 2);
    } catch (e) { apiOutput.textContent = `Error: ${e}`; }
  }));

  apiSection.appendChild(btnRow);
  apiSection.appendChild(apiOutput);
  container.appendChild(apiSection);

  // Actions section
  const actionsSection = createSection("Actions");
  const actionsRow = document.createElement("div");
  actionsRow.className = "debug-btn-row";

  actionsRow.appendChild(createBtn("stellaConnected = true", () => {
    stellaConnected.set(true);
    refreshState();
  }));

  actionsRow.appendChild(createBtn("stellaConnected = false", () => {
    stellaConnected.set(false);
    refreshState();
  }));

  actionsRow.appendChild(createBtn("Clear focusedDate", () => {
    focusedDate.set(null);
    refreshState();
  }));

  actionsSection.appendChild(actionsRow);
  container.appendChild(actionsSection);

  // Animations section
  const animSection = createSection("Animations");
  const animRow = document.createElement("div");
  animRow.className = "debug-btn-row";

  animRow.appendChild(createBtn("Summary (今月)", () => playSummaryAnimation()));
  animRow.appendChild(createBtn("春 (4月)", () => playSummaryAnimation(4)));
  animRow.appendChild(createBtn("夏 (7月)", () => playSummaryAnimation(7)));
  animRow.appendChild(createBtn("秋 (11月)", () => playSummaryAnimation(11)));
  animRow.appendChild(createBtn("冬 (12月)", () => playSummaryAnimation(12)));

  animSection.appendChild(animRow);
  container.appendChild(animSection);

  // Effects section (moved from settings)
  const effectsSection = createSection("振り返り演出");
  const effectsRow = document.createElement("div");
  effectsRow.className = "debug-btn-row";

  const seasons: { label: string; season: "spring" | "summer" | "autumn" | "winter" }[] = [
    { label: "春 Q1", season: "spring" },
    { label: "夏 Q2", season: "summer" },
    { label: "秋 Q3", season: "autumn" },
    { label: "冬 Q4", season: "winter" },
  ];
  for (const { label, season } of seasons) {
    effectsRow.appendChild(createBtn(label, () => {
      playSnapshot({ season, greeting: `テスト — ${label}の四半期サマリー`, stats: [
        { label: "Total Time", value: '<span class="num">142h</span>' },
        { label: "Active Days", value: '<span class="num">68</span>日' },
        { label: "People Met", value: '<span class="num">87</span>人' },
        { label: "Photos", value: '<span class="num">284</span>枚' },
      ]});
    }));
  }
  effectsRow.appendChild(createBtn("花びら", () => playSummaryAnimation()));

  effectsSection.appendChild(effectsRow);
  container.appendChild(effectsSection);

  // Environment info
  const envSection = createSection("Environment");
  const envOutput = document.createElement("pre");
  envOutput.className = "debug-output";
  envOutput.textContent = JSON.stringify({
    mode: import.meta.env.MODE,
    dev: import.meta.env.DEV,
    prod: import.meta.env.PROD,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
  }, null, 2);
  envSection.appendChild(envOutput);
  container.appendChild(envSection);

  return container;
}

// デバッグセクションの外枠 (h3 タイトル付き) を作って返す
function createSection(title: string): HTMLElement {
  const section = document.createElement("div");
  section.className = "debug-section";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  section.appendChild(h3);
  return section;
}

// クリックでハンドラを呼ぶデバッグ用ボタン要素を作って返す
function createBtn(label: string, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "debug-btn";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}
