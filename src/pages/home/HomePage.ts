import {
  getWeekLaneData,
  getDayFocusData,
  saveDayMemo,
  addManualMarker,
  removeManualMarker,
  getStartupInfo,
} from "@/api/commands";
import { showToast } from "@/utils/toast";
import { escapeHtml as esc, errMessage } from "@/utils/html";
import { MESSAGES } from "@/utils/messages";
import { formatHourMinute, formatDuration as fmtDurationJa } from "@/utils/datetime";
import { createGeneration } from "@/utils/generation";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  currentWeekStart,
  focusedDate,
  stellaConnected,
  settings,
  notifications,
  getMonday,
  Subscriptions,
} from "@/state/store";
import type {
  WeekLaneData,
  DayFocusData,
  MarkerSpan,
  ManualMarker,
  PhotoEntry,
  VisitPlayer,
} from "@/state/types";

// HomePage は 2 モードを切り替える単一ページ:
//   - 週ビュー: 日曜始まり 7 日分のタイムラインレーン (currentWeekStart 駆動)
//   - フォーカスビュー: 1 日の詳細パネル (focusedDate 駆動、week レーンも縦に拡張表示)
// 週レーンと詳細パネルを同居させ、focused class の付け外しと CSS で見た目を切替えている。
// loadGen / memoGen は遅延 await 中に別読込が走った場合に古い結果を破棄するための世代カウンタ。
export function HomePage(subs: Subscriptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "home-page";

  if (!stellaConnected.get()) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✦</div>
        <p class="empty-state-message">${esc(MESSAGES.ui.stellaCheckingConnection)}</p>
        <p class="empty-state-hint">${esc(MESSAGES.ui.stellaCheckHint)}</p>
        <button class="empty-state-retry">${esc(MESSAGES.ui.stellaReconnect)}</button>
      </div>
    `;
    const retryBtn = container.querySelector<HTMLButtonElement>(".empty-state-retry");
    if (retryBtn) {
      retryBtn.addEventListener("click", async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = MESSAGES.ui.stellaReconnecting;
        try {
          const info = await getStartupInfo();
          stellaConnected.set(info.stella_connected);
          notifications.set(info.pending_notifications);
        } catch {
          /* */
        }
        retryBtn.disabled = false;
        retryBtn.textContent = MESSAGES.ui.stellaReconnect;
      });
    }
    return container;
  }

  // Back button (replaces week-nav in focus mode)
  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = MESSAGES.ui.backToWeek;
  backBtn.addEventListener("click", () => focusedDate.set(null));

  // Page head
  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>${esc(MESSAGES.ui.todayHeading)}</h1><span class="sub"></span>`;
  const subLabel = pageHead.querySelector<HTMLElement>(".sub")!;

  // Week navigation
  const weekNav = document.createElement("div");
  weekNav.className = "week-nav";

  const prevWeekBtn = document.createElement("button");
  prevWeekBtn.className = "cal-arrow";
  prevWeekBtn.textContent = "‹";
  prevWeekBtn.addEventListener("click", () => shiftWeek(-1));

  const weekLabel = document.createElement("div");
  weekLabel.className = "week-label";

  const nextWeekBtn = document.createElement("button");
  nextWeekBtn.className = "cal-arrow";
  nextWeekBtn.textContent = "›";
  nextWeekBtn.addEventListener("click", () => shiftWeek(1));

  const todayBtn = document.createElement("button");
  todayBtn.className = "today-btn";
  todayBtn.textContent = MESSAGES.ui.thisWeek;
  todayBtn.addEventListener("click", () => {
    currentWeekStart.set(getMonday());
  });

  weekNav.appendChild(prevWeekBtn);
  weekNav.appendChild(weekLabel);
  weekNav.appendChild(nextWeekBtn);
  weekNav.appendChild(todayBtn);

  // Home layout
  const homeLayout = document.createElement("div");
  homeLayout.className = "home-layout";

  // Lane wrap
  const laneWrap = document.createElement("div");
  laneWrap.className = "lane-wrap";

  const laneHeader = document.createElement("div");
  laneHeader.className = "lane-header";

  const laneBody = document.createElement("div");
  laneBody.className = "lane-body";

  const laneFoot = document.createElement("div");
  laneFoot.className = "lane-foot";
  laneFoot.textContent = MESSAGES.ui.laneFootHint;

  const zoomControls = document.createElement("div");
  zoomControls.className = "lane-zoom";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "zoom-label";
  zoomLabel.textContent = "6h";
  const zoomHint = document.createElement("span");
  zoomHint.className = "zoom-hint";
  zoomHint.textContent = MESSAGES.ui.zoomHint;
  zoomControls.appendChild(zoomLabel);
  zoomControls.appendChild(zoomHint);

  laneWrap.appendChild(laneHeader);
  laneWrap.appendChild(laneBody);
  laneWrap.appendChild(laneFoot);
  laneWrap.appendChild(zoomControls);

  // Memo paper
  const memoPaper = document.createElement("div");
  memoPaper.className = "memo-paper";
  const memoInner = document.createElement("div");
  memoInner.className = "memo-inner";
  // Loop 4 UX-06: 「日付を選んでください」は loading/empty 文言とは別カテゴリ (ガイド文言) のためそのまま
  memoInner.innerHTML = `<div class="memo-empty">${esc(MESSAGES.ui.memoEmptyPick)}<br>${esc(MESSAGES.ui.memoEmptyHint)}</div>`;
  memoPaper.appendChild(memoInner);

  homeLayout.appendChild(laneWrap);
  homeLayout.appendChild(memoPaper);

  container.appendChild(pageHead);
  container.appendChild(weekNav);
  container.appendChild(backBtn);
  container.appendChild(homeLayout);

  // loadGen: loadWeek() 内の各 await 後に gen 比較し、古い結果の renderLane を抑止する。
  // Loop 6 refactor: 単純な counter + 比較ロジックを utils/generation の createGeneration に集約。
  const loadGen = createGeneration();
  // 直近 renderLane が決定した表示時間帯（フォーカスモードのグリッド線計算で使う）
  let lastHourStart = 0;
  let lastHourEnd = 24;
  let lastTotalHours = 24;
  // フォーカス時のズーム倍率（一度に何時間ぶんを表示するか）。adjustZoom で steps を行き来。
  let visibleHours = 6;
  // 直近の loadWeek() Promise。focusedDate 購読側で「週レーン描画後に enterFocusMode する」順序を担保する
  let lastLoadWeek: Promise<void> = Promise.resolve();

  // 週ナビと「week of ...」サブラベルの日付範囲文字列を更新する
  function updateSubLabel(): void {
    const [y, m, d] = currentWeekStart.get().split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 6);
    const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
    subLabel.textContent = `${fmt(start)} 〜 ${fmt(end)} ${MESSAGES.ui.weekRangeSuffix}`;
    weekLabel.textContent = `${start.getFullYear()}年 ${fmt(start)} 〜 ${fmt(end)}`;
  }

  // 現在週を offset 週ぶんずらす（Date コンストラクタが日数オーバーフローを自然に処理）
  function shiftWeek(offset: number): void {
    const [y, m, d] = currentWeekStart.get().split("-").map(Number);
    const date = new Date(y, m - 1, d + offset * 7);
    const ny = date.getFullYear();
    const nm = String(date.getMonth() + 1).padStart(2, "0");
    const nd = String(date.getDate()).padStart(2, "0");
    currentWeekStart.set(`${ny}-${nm}-${nd}`);
  }

  // 現在週のレーンデータをバックエンドから取得して描画する。
  // 120ms のフェードアウトを挟むため await が複数回ある → 各 await 後に gen を確認し、
  // 連打や週切替で古い結果が後勝ちしないようにする。
  async function loadWeek(): Promise<void> {
    const gen = loadGen.next();
    updateSubLabel();

    // フェードアウト中（120ms）に視覚的に切替えを示す
    laneWrap.classList.add("lane-switching");
    await new Promise((r) => setTimeout(r, 120));
    if (!loadGen.isCurrent(gen)) return;

    laneHeader.innerHTML = "";
    // Loop 4 UX-06: loading/loadError 文言は MESSAGES に集約
    laneBody.innerHTML = `<div class="loading" style="grid-column: 1/-1;">${esc(MESSAGES.loading)}</div>`;

    try {
      const data: WeekLaneData = await getWeekLaneData(currentWeekStart.get());
      if (!loadGen.isCurrent(gen)) return;
      renderLane(data);
    } catch {
      if (!loadGen.isCurrent(gen)) return;
      laneBody.innerHTML = `<div class="memo-empty" style="grid-column: 1/-1;">${esc(MESSAGES.loadError)}</div>`;
    }

    // Fade back in
    laneWrap.classList.remove("lane-switching");
  }

  // 週間タイムラインのヘッダー (曜日/日付) と本体 (時間軸 + 7 日分の縦レーン) を描画する。
  // visit ブロックは絶対配置 (%) で、prevBottomHour による「直前ブロックの底以下に出さない」
  // 補正で、ごく短い訪問が重なって不可視になるのを防ぐ。
  function renderLane(data: WeekLaneData): void {
    // 設定の view_hour_start/end を優先してキャップする
    const s = settings.get();
    // Loop 7 UI 防御: cfgEnd <= cfgStart (不正設定/同値) の場合は totalHours=0 で applyZoom 計算が
    // 崩壊するため、安全なデフォルト 0..24 に巻き戻す。
    let cfgStart = s.view_hour_start;
    let cfgEnd = s.view_hour_end;
    if (cfgEnd <= cfgStart) {
      cfgStart = 0;
      cfgEnd = 24;
    }
    let hour_start = data.hour_start;
    let hour_end = data.hour_end;
    hour_start = Math.max(hour_start, cfgStart);
    hour_end = Math.min(hour_end, cfgEnd);
    if (hour_end <= hour_start) {
      hour_start = cfgStart;
      hour_end = cfgEnd;
    }
    const totalHours = hour_end - hour_start;
    lastHourStart = hour_start;
    lastHourEnd = hour_end;
    lastTotalHours = totalHours;

    // Header
    laneHeader.innerHTML = "";
    const corner = document.createElement("div");
    corner.className = "lane-corner";
    laneHeader.appendChild(corner);

    for (const lane of data.lanes) {
      const head = document.createElement("div");
      head.className = "day-head";
      head.dataset.date = lane.date;
      if (!lane.has_activity) head.classList.add("inactive");
      if (isToday(lane.date)) head.classList.add("today");
      head.innerHTML = `<div class="wd">${esc(lane.weekday)}</div><div class="num">${lane.date.split("-")[2].replace(/^0/, "")}</div>`;
      head.addEventListener("click", () => {
        if (lane.has_activity) focusedDate.set(lane.date);
      });
      laneHeader.appendChild(head);
    }

    // Body
    laneBody.innerHTML = "";

    // Grid lines (absolute positioned, out of grid flow)
    for (let h = hour_start; h < hour_end; h += 2) {
      const line = document.createElement("div");
      line.className = "hour-grid-line";
      line.style.top = `${((h - hour_start) / totalHours) * 100}%`;
      laneBody.appendChild(line);
    }

    // Time axis (grid column 1)
    const timeAxis = document.createElement("div");
    timeAxis.className = "time-axis";
    for (let h = hour_start; h < hour_end; h += 2) {
      const mark = document.createElement("div");
      mark.className = "hour-mark";
      mark.style.top = `${((h - hour_start) / totalHours) * 100}%`;
      const displayHour = h >= 24 ? h - 24 : h;
      mark.textContent = `${displayHour}:00`;
      timeAxis.appendChild(mark);
    }
    laneBody.appendChild(timeAxis);

    // Day lanes (grid columns 2-8)
    for (const lane of data.lanes) {
      const col = document.createElement("div");
      col.className = "day-lane";
      col.dataset.date = lane.date;
      if (isToday(lane.date)) col.classList.add("today");
      if (lane.has_activity) {
        col.style.cursor = "pointer";
        col.addEventListener("click", () => focusedDate.set(lane.date));
      }

      // R2-M-18: 表示範囲外の visit は描画せず、件数バッジに集計する
      let outOfRange = 0;
      let prevBottomHour = 0;
      for (let vi = 0; vi < lane.visits.length; vi++) {
        const visit = lane.visits[vi];
        // 完全に表示範囲外 (end <= start_visible or start >= end_visible) はスキップ
        if (visit.end_hour <= hour_start || visit.start_hour >= hour_end) {
          outOfRange += 1;
          continue;
        }
        const block = document.createElement("div");
        block.className = "visit-block";
        // C2: 写真フィルタで元配列の visit と対応付けるため、元 index を data 属性で持つ
        block.dataset.visitIdx = String(vi);
        const visualStart = Math.max(visit.start_hour, prevBottomHour, hour_start);
        const visualEnd = Math.min(Math.max(visit.end_hour, visualStart), hour_end);
        const top = ((visualStart - hour_start) / totalHours) * 100;
        const height = ((visualEnd - visualStart) / totalHours) * 100;

        block.style.top = `${Math.max(0, top)}%`;
        block.style.height = `${Math.max(0.15, Math.min(height, 100 - Math.max(0, top)))}%`;
        block.style.backgroundColor = hexToRgba(visit.color_hex, 0.3);
        block.style.borderLeftColor = visit.color_hex;
        block.style.animationDelay = `${0.05 + vi * 0.04}s`;
        block.innerHTML = `<span class="v-name">${esc(visit.world_name)}</span><span class="v-time">${formatHour(visit.start_hour)} – ${formatHour(visit.end_hour)}</span>`;
        block.title = `${visit.world_name} (${visit.duration_min}min)`;
        if (height < 3) block.classList.add("visit-compact");
        col.appendChild(block);
        prevBottomHour = Math.max(visualEnd, visualStart + (0.15 / 100) * totalHours);
      }

      if (outOfRange > 0) {
        const badge = document.createElement("div");
        badge.className = "lane-out-of-range";
        badge.textContent = `外 +${outOfRange}件`;
        badge.title = "タイムライン表示範囲外の訪問。設定で開始/終了時刻を変更すると表示できます。";
        badge.style.cssText =
          "position:absolute;bottom:2px;right:2px;font-size:10px;padding:1px 4px;border-radius:3px;background:rgba(140,90,90,0.18);color:#a55;pointer-events:none;";
        col.style.position = col.style.position || "relative";
        col.appendChild(badge);
      }

      // Notification pins for this day
      const dayNotifs = notifications.get().filter((n) => n.scheduled_at.startsWith(lane.date));
      for (const notif of dayNotifs) {
        const notifHour = parseNotifHour(notif.scheduled_at);
        // Loop 7 UI 防御: parseNotifHour が null (Invalid Date) を返したらピン自体を生成しない
        if (notifHour === null) continue;
        const pin = document.createElement("div");
        pin.className = "notif-pin";
        if (notifHour >= hour_start && notifHour <= hour_end) {
          pin.style.top = `${((notifHour - hour_start) / totalHours) * 100}%`;
        } else {
          pin.style.top = "2px";
        }
        pin.textContent = notif.title;
        pin.title = `${notif.title} (${notif.event_type})`;
        col.appendChild(pin);
      }

      laneBody.appendChild(col);
    }
  }

  // visibleHours の値に応じて time-axis と focused day-lane の高さを伸縮させる。
  // フォーカスモード時のみ意味があり、週ビューでは day-lane が height: auto のままなので何もしない。
  function applyZoom(): void {
    // Loop 7 UI 防御: visibleHours が 0 以下だと contentH が Infinity/NaN になり、
    // style.height に流すと描画崩壊やスクロールハングを誘発するため早期 return。
    if (visibleHours <= 0) return;
    if (lastTotalHours <= 0) return;
    const viewH = laneBody.clientHeight;
    const contentH = viewH * (lastTotalHours / visibleHours);

    const timeAxisEl = laneBody.querySelector<HTMLElement>(".time-axis");
    if (timeAxisEl) timeAxisEl.style.height = `${contentH}px`;

    const focusedLane = laneBody.querySelector<HTMLElement>(".day-lane.focused");
    if (focusedLane) focusedLane.style.height = `${contentH}px`;

    const scale = Math.min(1.6, Math.max(0.85, 6 / visibleHours));
    laneBody.style.setProperty("--zoom-scale", String(scale));

    zoomLabel.textContent = `${visibleHours}h`;
  }

  // ズームレベルを steps[] 上で 1 段階増減する（Shift+ホイールから呼ばれる）
  function adjustZoom(delta: number): void {
    const steps = [1, 2, 3, 4, 6, 8, 12, 24];
    let idx = steps.indexOf(visibleHours);
    if (idx === -1) idx = 4;
    const next = idx + delta;
    if (next < 0 || next >= steps.length) return;
    visibleHours = steps[next];
    applyZoom();
  }

  // 1 日の詳細ビューに切替える: 該当 day-head/day-lane に focused class を付け、
  // メモ/写真/統計をロードする。グリッド線追加は rAF まで遅らせて DOM サイズ確定後に行う。
  function enterFocusMode(date: string): void {
    container.classList.add("focus-mode");
    laneHeader.querySelectorAll(".day-head").forEach((el) => {
      el.classList.toggle("focused", el.getAttribute("data-date") === date);
    });
    laneBody.querySelectorAll(".day-lane").forEach((el) => {
      el.classList.toggle("focused", el.getAttribute("data-date") === date);
    });

    void loadMemo(date);

    requestAnimationFrame(() => {
      if (lastTotalHours <= 0) return;

      // フォーカス中レーンにのみ濃いグリッド線を引く（拡大表示で目盛りを読みやすくする）
      const focusedLane = laneBody.querySelector<HTMLElement>(".day-lane.focused");
      if (focusedLane) {
        const frag = document.createDocumentFragment();
        for (let h = lastHourStart; h < lastHourEnd; h += 2) {
          const line = document.createElement("div");
          line.className = "focus-grid-line";
          line.style.top = `${((h - lastHourStart) / lastTotalHours) * 100}%`;
          frag.appendChild(line);
        }
        focusedLane.appendChild(frag);
      }

      applyZoom();
    });
  }

  // フォーカスを解除して週表示に戻す: focused class を全部剥がし、追加した grid 線を撤去
  function exitFocusMode(): void {
    container.classList.remove("focus-mode");
    laneHeader
      .querySelectorAll(".day-head.focused")
      .forEach((el) => el.classList.remove("focused"));
    laneBody.style.removeProperty("--zoom-scale");

    const timeAxisEl = laneBody.querySelector<HTMLElement>(".time-axis");
    if (timeAxisEl) timeAxisEl.style.height = "";
    laneBody.querySelectorAll<HTMLElement>(".day-lane").forEach((el) => {
      el.style.height = "";
      el.classList.remove("focused");
    });
    laneBody.querySelectorAll(".focus-grid-line").forEach((el) => el.remove());
    laneBody.scrollTop = 0;

    memoInner.innerHTML = `<div class="memo-empty">${esc(MESSAGES.ui.memoEmptyPick)}<br>${esc(MESSAGES.ui.memoEmptyHint)}</div>`;
  }

  // memoGen: loadMemo の await 中に別日が選ばれた場合に古い描画を破棄するための世代カウンタ。
  // Loop 6 refactor: loadGen と同じく createGeneration に集約。
  const memoGen = createGeneration();
  // メモ入力 1 秒後に走らせる自動保存タイマー。ページ破棄時に必ず clearTimeout する。
  let memoSaveTimeout: number | undefined;
  let pendingMemoSave: { date: string; getValue: () => string } | null = null;
  // メモ自動保存の失敗トーストは頻発し得る (入力中の連続失敗等) ため
  // 最後の表示から 5 秒以内は抑止する。lastToastAt は performance.now() ベース。
  const MEMO_SAVE_TOAST_THROTTLE_MS = 5000;
  let lastMemoSaveToastAt = 0;
  function notifyMemoSaveError(e: unknown): void {
    const now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    if (now - lastMemoSaveToastAt < MEMO_SAVE_TOAST_THROTTLE_MS) return;
    lastMemoSaveToastAt = now;
    showToast({ title: MESSAGES.ui.memoSaveFailedTitle, body: errMessage(e), kind: "error" });
  }
  // unmount 時に未保存のメモを flush する
  subs.add(() => {
    if (memoSaveTimeout) {
      clearTimeout(memoSaveTimeout);
      memoSaveTimeout = undefined;
      if (pendingMemoSave) {
        const { date, getValue } = pendingMemoSave;
        saveDayMemo(date, getValue()).catch((e: unknown) => {
          notifyMemoSaveError(e);
        });
        pendingMemoSave = null;
      }
    }
  });

  // 日付切替時に未保存のメモを flush する (保存完了まで await できるよう async)
  // L5 Task 3: pendingMemoSave = null は saveDayMemo 成功後に移動する。
  //   await 前に null にすると、保存中に新たな入力が来た場合に
  //   別の pending と入れ替わって rollback できなくなるため、
  //   成功確認後にだけ「現在の pending と一致していたら null 化」する。
  //   失敗時はリトライキューに残す (= null 化しない / 上書きが無ければ復元)。
  async function flushPendingMemo(): Promise<void> {
    if (!memoSaveTimeout && !pendingMemoSave) return;
    if (memoSaveTimeout) {
      clearTimeout(memoSaveTimeout);
      memoSaveTimeout = undefined;
    }
    if (pendingMemoSave) {
      const target = pendingMemoSave;
      try {
        await saveDayMemo(target.date, target.getValue());
        // 保存中に別の入力で pendingMemoSave が差し替わっていなければ null 化する
        if (pendingMemoSave === target) pendingMemoSave = null;
      } catch (e) {
        notifyMemoSaveError(e);
        // 失敗時は pendingMemoSave に残す (新 pending で上書きされていなければ復元)
        pendingMemoSave ??= target;
      }
    }
  }

  // 指定日の詳細データを取得して renderMemo に渡す。loadGen と同じ理由で世代比較する。
  async function loadMemo(date: string): Promise<void> {
    await flushPendingMemo();
    const gen = memoGen.next();
    // Loop 4 UX-06: loading/loadError 文言は MESSAGES に集約
    memoInner.innerHTML = `<div class="loading">${esc(MESSAGES.loading)}</div>`;
    try {
      const data = await getDayFocusData(date);
      if (!memoGen.isCurrent(gen)) return;
      renderMemo(data);
    } catch (e) {
      if (!memoGen.isCurrent(gen)) return;
      memoInner.innerHTML = `<div class="memo-empty">${esc(MESSAGES.loadError)}: ${esc(errMessage(e))}</div>`;
    }
  }

  // 訪問ブロッククリックで写真をフィルタするため、最新の photos 要素と全写真を保持しておく
  let activePhotosEl: HTMLElement | null = null;
  let allPhotos: PhotoEntry[] = [];
  // L5 Mem: メモのコンテキストメニュー外側クリック dismiss を束ねる AbortController。
  // page-scoped に 1 個だけ持ち、新メニューを出す前に旧 controller を abort() → 新規生成する。
  // これにより右クリック連打時に dismiss リスナーが accumulate するリークを防ぐ。
  let markerMenuCtrl: AbortController | null = null;
  // page unmount 時にも残メニューと dismiss を片付ける
  subs.add(() => {
    if (markerMenuCtrl) {
      markerMenuCtrl.abort();
      markerMenuCtrl = null;
    }
    document.querySelectorAll(".marker-context-menu").forEach((m) => m.remove());
  });

  // 日別パネル全体 (見出し/メモカード/めもきっと/統計/写真) を描画する。
  // markerView と textarea は display 切替で交互に表示し、編集中はテキストエリア、
  // 通常表示時はマーカー装飾付きの div を見せる。
  function renderMemo(data: DayFocusData): void {
    memoInner.innerHTML = "";
    allPhotos = data.photos;

    const dateEl = document.createElement("div");
    dateEl.className = "memo-date";
    dateEl.textContent = data.date_label;
    memoInner.appendChild(dateEl);

    // Memo note card (pinned paper on wood wall)
    const noteCard = document.createElement("div");
    noteCard.className = "memo-note-card";

    // Loop 7 UI 防御: DB に 0 や負値が直書きされても textarea がロック (0 文字制限) されないよう下限 1 を保証。
    const maxLen = Math.max(1, settings.get().memo_max_length);
    const memoText = data.memo ?? "";

    const markerView = document.createElement("div");
    markerView.className = "memo-marker-view";
    renderMarkerText(markerView, memoText, data.memo_markers, data.manual_markers);
    wireMarkerContextMenu(markerView, data);

    const textarea = document.createElement("textarea");
    textarea.className = "memo-textarea";
    textarea.placeholder = MESSAGES.ui.memoPlaceholder;
    textarea.maxLength = maxLen;
    textarea.value = memoText;
    textarea.style.display = "none";

    const counter = document.createElement("div");
    counter.className = "memo-counter";
    counter.textContent = `${memoText.length} / ${maxLen}`;

    markerView.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("marker-underline")) return;
      markerView.style.display = "none";
      textarea.style.display = "";
      textarea.focus();
    });

    textarea.addEventListener("blur", () => {
      textarea.style.display = "none";
      markerView.style.display = "";
      renderMarkerText(markerView, textarea.value, data.memo_markers, data.manual_markers);
      wireMarkerContextMenu(markerView, data);
    });

    // L4 D-I18N-2 / IME 対応: 日本語 IME 変換中 (composition 中) は自動保存タイマーを
    //   一時停止する。compositionstart で suspendMemoSave=true にして input ハンドラ内の
    //   タイマー登録をスキップし、compositionend で suspendMemoSave=false に戻して
    //   1 回だけ即時タイマーを登録 (確定文字列を反映)。
    //   これにより、変換中の一時的な文字列 (例: "にほんご" → "日本語") が DB に書込まれて
    //   競合状態 (確定前 fetch → 上書き) を引き起こすのを防ぐ。
    //
    // L7-IMERace: compositionend / input / insertChipToMemo の 3 経路すべてで
    //   「既存タイマー clear → 新規登録 → fire 時に textarea.value を直接読む」を
    //   `scheduleMemoSave` に集約する。closure で値を captuer せず、必ず最新の
    //   textarea.value を fire 時点で参照することで、登録〜発火間に来た IME 確定や
    //   高速タイピングが古い値で上書きされる事故を防ぐ。
    const scheduleMemoSave = (): void => {
      if (memoSaveTimeout !== undefined) {
        clearTimeout(memoSaveTimeout);
        memoSaveTimeout = undefined;
      }
      pendingMemoSave = { date: data.date, getValue: () => textarea.value };
      memoSaveTimeout = window.setTimeout(() => {
        // fire 時点の textarea.value を直接読む (closure キャプチャは敢えてしない)
        const latest = textarea.value;
        saveDayMemo(data.date, latest).catch((e: unknown) => {
          notifyMemoSaveError(e);
        });
        pendingMemoSave = null;
        memoSaveTimeout = undefined;
      }, 1000);
    };

    let suspendMemoSave = false;
    textarea.addEventListener("compositionstart", () => {
      suspendMemoSave = true;
      // 進行中のタイマーがあれば一旦解除 (変換確定前に発火しないようにする)
      if (memoSaveTimeout !== undefined) {
        clearTimeout(memoSaveTimeout);
        memoSaveTimeout = undefined;
      }
    });
    textarea.addEventListener("compositionend", () => {
      suspendMemoSave = false;
      counter.textContent = `${textarea.value.length} / ${maxLen}`;
      // compositionend 直後に確定文字列を 1 回だけ保存スケジュール。
      // scheduleMemoSave 内で既存タイマーを必ず先に clear するため二重登録 race は無い。
      scheduleMemoSave();
    });

    textarea.addEventListener("input", () => {
      counter.textContent = `${textarea.value.length} / ${maxLen}`;
      // IME 変換中 (composition 中) は input イベントが連発するため自動保存タイマーを登録しない。
      // compositionend 側で 1 回だけ登録する。
      if (suspendMemoSave) {
        // 変換中も pendingMemoSave は更新しておく (unmount 時の flush 用)
        pendingMemoSave = { date: data.date, getValue: () => textarea.value };
        return;
      }
      scheduleMemoSave();
    });

    noteCard.appendChild(markerView);
    noteCard.appendChild(textarea);
    noteCard.appendChild(counter);
    memoInner.appendChild(noteCard);

    // Memokitto
    const kittoChips = data.memokitto;
    if (kittoChips.length > 0) {
      memoInner.appendChild(
        renderMemokittoTray(kittoChips, textarea, markerView, data, counter, maxLen),
      );
    }

    const statsEl = document.createElement("div");
    statsEl.className = "memo-stats";
    statsEl.innerHTML = `
      <div class="memo-stat"><div class="lbl">滞在</div><div class="val"><span class="num">${formatDuration(data.total_duration_min)}</span></div></div>
      <div class="memo-stat"><div class="lbl">人物</div><div class="val"><span class="num">${data.people_count}</span>人</div></div>
      <div class="memo-stat"><div class="lbl">写真</div><div class="val"><span class="num">${data.photo_count}</span>枚</div></div>
    `;
    memoInner.appendChild(statsEl);

    // Photos with lightbox
    const photosEl = document.createElement("div");
    photosEl.className = "memo-photos";
    activePhotosEl = photosEl;
    renderPhotoGrid(photosEl, data.photos);
    memoInner.appendChild(photosEl);

    // Wire up visit block clicks for photo filtering
    wireVisitPhotoFilter(data);
  }

  // 写真サムネイルを最大 maxPhotos (7) 枚まで並べ、超過分は "+N" として lightbox を開く起点にする
  function renderPhotoGrid(photosEl: HTMLElement, photos: PhotoEntry[]): void {
    photosEl.innerHTML = "";
    if (photos.length === 0) {
      photosEl.innerHTML = `<div class="lbl">写真 <span class="count">0枚</span></div>`;
      return;
    }
    photosEl.innerHTML = `<div class="lbl">写真 <span class="count">${photos.length}枚</span></div>`;
    const grid = document.createElement("div");
    grid.className = "photo-grid";
    const maxPhotos = 7;
    const paths = photos.map((p) => p.file_path);
    for (let i = 0; i < Math.min(photos.length, maxPhotos); i++) {
      const thumb = document.createElement("div");
      thumb.className = "photo-thumb";
      thumb.style.backgroundImage = `url('${convertFilePath(photos[i].file_path)}')`;
      thumb.addEventListener("click", (e) => {
        e.stopPropagation();
        openLightbox(paths, i);
      });
      grid.appendChild(thumb);
    }
    if (photos.length > maxPhotos) {
      const more = document.createElement("div");
      more.className = "photo-more";
      more.textContent = `+${photos.length - maxPhotos}`;
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        openLightbox(paths, maxPhotos);
      });
      grid.appendChild(more);
    }
    photosEl.appendChild(grid);
  }

  // フォーカス中レーンの訪問ブロックにクリックハンドラを付け、選択中の訪問の時間帯で
  // 写真をフィルタ、Join 記録（同席ユーザー）を写真の上に挿入する。
  // 同じブロックを再クリックで解除し、全写真表示に戻す。
  function wireVisitPhotoFilter(data: DayFocusData): void {
    const focusedLane = laneBody.querySelector(".day-lane.focused");
    if (!focusedLane) return;

    focusedLane.querySelectorAll(".visit-block").forEach((block) => {
      block.addEventListener("click", (e) => {
        e.stopPropagation();
        // C2: 表示範囲外スキップで DOM 順と data.visits の index がずれるため、data 属性から元 index を引く
        const idxStr = (block as HTMLElement).dataset.visitIdx;
        const idx = idxStr === undefined ? -1 : Number(idxStr);
        if (idx < 0 || idx >= data.visits.length) return;
        const visit = data.visits[idx];
        if (!activePhotosEl) return;

        const wasActive = block.classList.contains("visit-selected");
        focusedLane
          .querySelectorAll(".visit-block.visit-selected")
          .forEach((b) => b.classList.remove("visit-selected"));

        const existingJoin = memoInner.querySelector(".join-record");
        if (existingJoin) existingJoin.remove();

        if (wasActive) {
          renderPhotoGrid(activePhotosEl, allPhotos);
        } else {
          block.classList.add("visit-selected");
          const filtered = allPhotos.filter(
            (p) => p.hour >= visit.start_hour && p.hour < visit.end_hour,
          );
          renderPhotoGrid(activePhotosEl, filtered);

          if (visit.players && visit.players.length > 0) {
            const joinEl = renderJoinRecord(visit.players);
            activePhotosEl.parentNode!.insertBefore(joinEl, activePhotosEl);
          }
        }
      });
    });
  }

  // Join記録セクションを構築する (R2-M-22: VisitPlayer 構造を受ける)
  function renderJoinRecord(players: VisitPlayer[]): HTMLElement {
    const section = document.createElement("div");
    section.className = "join-record";

    const title = document.createElement("div");
    title.className = "join-record-title";
    title.textContent = "Join記録";
    section.appendChild(title);

    const list = document.createElement("div");
    list.className = "join-record-list";
    for (const p of players) {
      const chip = document.createElement("span");
      chip.className = "join-record-name";
      chip.textContent = p.name;
      chip.dataset.userId = p.user_id;
      chip.title = p.user_id;
      list.appendChild(chip);
    }
    section.appendChild(list);

    return section;
  }

  // 描画用に自動マーカー (kind=world/person) と手動マーカー (kind=color) を統一表現にする中間型
  interface UnderlineMark {
    start: number;
    end: number;
    kind: string;
    title: string;
    markerId?: number;
  }

  // メモ本文をマーカー装飾付きで描画する。
  // start/end は **Unicode scalar (char) 位置** (L7-MarkerUnit: バックエンド全層と整合)。
  // 描画上は `Array.from(text)` で scalar 配列化してから slice / 連結することで、
  // 絵文字 (サロゲートペア) が分断されずに 1 char 単位で扱われる。
  //
  // L7-MarkerDedupe: 重複・破綻マーカーの厳格化:
  //   1. `start >= end` のマーカーは完全に捨てる (描画不可能なゼロ幅)
  //   2. 同 start マーカーが複数ある場合は **end が大きい (より広い範囲) を優先** する
  //      (例: 人名 "Aki" と "Aki さん" が同じ start を持つなら広い方を採用)
  //   3. dedupe 後の cursor 進行で `m.start < cursor || m.end <= cursor` の重なり/逆行も排除
  function renderMarkerText(
    el: HTMLElement,
    text: string,
    autoMarkers: MarkerSpan[],
    manualMarkers: ManualMarker[],
  ): void {
    el.innerHTML = "";
    if (!text) return;

    // scalar 単位の配列化。textLenChar が m.end の上限。
    const chars = Array.from(text);
    const textLenChar = chars.length;
    const charSlice = (start: number, end: number): string => chars.slice(start, end).join("");

    const marks: UnderlineMark[] = [];
    for (const m of autoMarkers) {
      // L7-MarkerDedupe(1): start >= end は完全に捨てる
      if (m.start >= m.end) continue;
      if (m.start < textLenChar && m.end <= textLenChar) {
        marks.push({ start: m.start, end: m.end, kind: m.kind, title: m.text });
      }
    }
    for (const m of manualMarkers) {
      if (m.start >= m.end) continue;
      if (m.start < textLenChar && m.end <= textLenChar) {
        marks.push({ start: m.start, end: m.end, kind: m.color, title: "", markerId: m.id });
      }
    }

    if (marks.length === 0) {
      el.textContent = text;
      return;
    }

    // L7-MarkerDedupe(2): start 昇順 + 同 start なら end 降順 (広い範囲を先に採用)
    const sorted = marks.sort((a, b) => a.start - b.start || b.end - a.end);
    const deduped: UnderlineMark[] = [];
    for (const m of sorted) {
      // 同 (start, end) のマーカーが既に積まれていればスキップ (色違いの完全重複も含む)
      if (!deduped.some((d) => d.start === m.start && d.end === m.end)) {
        deduped.push(m);
      }
    }

    let cursor = 0;
    for (const m of deduped) {
      // L7-MarkerDedupe(3): cursor との完全な隙間/オーバーラップ排除
      //   - m.start < cursor: 既に描画済み範囲に食い込む → skip
      //   - m.end <= cursor: 後続だが終端が手前 (ゼロ幅 / 後退) → skip
      if (m.start < cursor) continue;
      if (m.end <= cursor) continue;
      if (m.start > cursor) {
        el.appendChild(document.createTextNode(charSlice(cursor, m.start)));
      }
      const span = document.createElement("span");
      span.className = "marker-underline";
      span.dataset.kind = m.kind;
      if (m.markerId !== undefined) span.dataset.markerId = String(m.markerId);
      span.textContent = charSlice(m.start, m.end);
      if (m.title) span.title = m.title;
      el.appendChild(span);
      cursor = m.end;
    }
    if (cursor < textLenChar) {
      el.appendChild(document.createTextNode(charSlice(cursor, textLenChar)));
    }
  }

  // 右クリックで色選択メニューを出し、選択範囲に手動マーカーを付ける/削除する。
  // 既存マーカーの上で右クリックした時のみ「マーカーを消す」項目を追加する。
  //
  // L5 Task 4: 既存メニュー破棄時に旧 AbortController を必ず abort してから
  //   DOM から消すことで、setTimeout(0) で登録された dismiss handler が
  //   新メニュー側まで生き残るのを防ぐ。page-scoped な markerMenuCtrl を
  //   contextmenu イベントごとに abort → 新規生成して使い回す。
  function wireMarkerContextMenu(markerView: HTMLElement, data: DayFocusData): void {
    markerView.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // 同時に複数メニューが開かないように既存メニューを破棄
      // L5 Task 4: 旧 controller も明示 abort して dismiss handler を確実に解除する
      if (markerMenuCtrl) {
        markerMenuCtrl.abort();
        markerMenuCtrl = null;
      }
      document.querySelectorAll(".marker-context-menu").forEach((m) => m.remove());

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !markerView.contains(sel.anchorNode)) return;

      const range = sel.getRangeAt(0);
      const fullText = data.memo ?? "";
      const offsets = getSelectionOffsets(markerView, range);
      if (offsets.start >= offsets.end) return;

      const clickedMarker = (e.target instanceof Element ? e.target : null)?.closest(
        "[data-marker-id]",
      );

      const menu = document.createElement("div");
      menu.className = "marker-context-menu";
      menu.style.left = `${e.clientX}px`;
      menu.style.top = `${e.clientY}px`;

      const colors = [
        { key: "red", label: "赤" },
        { key: "blue", label: "青" },
        { key: "green", label: "緑" },
        { key: "orange", label: "橙" },
      ];

      for (const c of colors) {
        const item = document.createElement("div");
        item.className = "marker-menu-item";
        item.dataset.color = c.key;
        item.textContent = c.label;
        item.addEventListener("click", async () => {
          menu.remove();
          try {
            const id = await addManualMarker(data.date, offsets.start, offsets.end, c.key);
            // 不変更新: push で in-place 改変せず新配列に差し替え、store の参照同一チェックを効かせる
            data.manual_markers = [
              ...data.manual_markers,
              { id, start: offsets.start, end: offsets.end, color: c.key },
            ];
            renderMarkerText(markerView, fullText, data.memo_markers, data.manual_markers);
            wireMarkerContextMenu(markerView, data);
          } catch (err) {
            showToast({
              title: MESSAGES.errors.markerAddFailed,
              body: errMessage(err),
              kind: "error",
            });
          }
        });
        menu.appendChild(item);
      }

      if (clickedMarker instanceof HTMLElement) {
        const markerId = Number(clickedMarker.dataset.markerId);
        const sep = document.createElement("div");
        sep.className = "marker-menu-sep";
        menu.appendChild(sep);
        const removeItem = document.createElement("div");
        removeItem.className = "marker-menu-item remove";
        removeItem.textContent = "マーカーを消す";
        removeItem.addEventListener("click", async () => {
          menu.remove();
          try {
            await removeManualMarker(markerId);
          } catch (err) {
            showToast({
              title: MESSAGES.errors.markerRemoveFailed,
              body: errMessage(err),
              kind: "error",
            });
            return;
          }
          data.manual_markers = data.manual_markers.filter((m) => m.id !== markerId);
          renderMarkerText(markerView, fullText, data.memo_markers, data.manual_markers);
          wireMarkerContextMenu(markerView, data);
        });
        menu.appendChild(removeItem);
      }

      document.body.appendChild(menu);

      // 外側クリックでメニューを閉じる。setTimeout(0) を挟むのは、コンテキストメニューを
      // 出すきっかけになった click イベントが先に bubble して即閉じてしまうのを避けるため。
      // AbortController で dismiss と関連リスナーを束ね、menu 破棄時に一括 abort して
      // 多重登録 (連続右クリックで dismiss が累積する) を防ぐ。
      //
      // L5 Task 4: setTimeout(0) で登録するスケジュール自身も signal で abortable にする。
      //   従来は setTimeout の callback 内で addEventListener していたため、
      //   timer が走るまでに別の右クリックが来ても旧 timer が abort されず、
      //   結果として複数の dismiss handler が一瞬重なって登録され得た。
      //   ctrl.signal.aborted を timer 内でチェックし、すでに abort 済みなら登録自体スキップする。
      const ctrl = new AbortController();
      markerMenuCtrl = ctrl;
      const dismiss = () => {
        menu.remove();
        ctrl.abort();
        if (markerMenuCtrl === ctrl) markerMenuCtrl = null;
      };
      setTimeout(() => {
        if (ctrl.signal.aborted) return;
        document.addEventListener("click", dismiss, { signal: ctrl.signal });
      }, 0);
    });
  }

  // container 内のテキスト選択範囲を Unicode スカラー値オフセットに変換する。
  // 「container 先頭から range 端まで」の Range を toString() し、Array.from(...).length で
  // サロゲートペアを 1 単位として数えることで、バックエンド (marker.rs) の char 単位と揃える。
  // C4: 以前は .length (UTF-16 code unit) で送信していたが、絵文字等を含むと Rust 側の char 単位とずれて
  // add_manual_marker が範囲超過エラーになるため Unicode スカラー単位に統一した。
  function getSelectionOffsets(
    container: HTMLElement,
    range: Range,
  ): { start: number; end: number } {
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = Array.from(preRange.toString()).length;

    const preEnd = document.createRange();
    preEnd.selectNodeContents(container);
    preEnd.setEnd(range.endContainer, range.endOffset);
    const end = Array.from(preEnd.toString()).length;

    return { start, end };
  }

  // めもきっと: 当日の世界名・ユーザー名をワンクリックでメモに追記できるシールパレット。
  // 蓋クリックで開閉、シールクリックで insertChipToMemo を呼んで textarea へ追記する。
  function renderMemokittoTray(
    chips: { label: string; category: string }[],
    textarea: HTMLTextAreaElement,
    markerView: HTMLElement,
    data: DayFocusData,
    counter: HTMLElement,
    maxLen: number,
  ): HTMLElement {
    const board = document.createElement("div");
    board.className = "kitto-sticker-board";

    const worlds = chips.filter((c) => c.category === "world");
    const people = chips.filter((c) => c.category === "person");
    const total = worlds.length + people.length;

    const boardBox = document.createElement("div");
    boardBox.className = "kitto-board";

    const lid = document.createElement("div");
    lid.className = "kitto-lid";
    lid.innerHTML = `<span class="kitto-lid-label">めもきっと</span><span class="kitto-lid-count">${total}枚</span><span class="kitto-lid-arrow">▶</span>`;
    boardBox.appendChild(lid);

    const inside = document.createElement("div");
    inside.className = "kitto-inside";

    let stickerIndex = 0;

    if (worlds.length > 0) {
      const sec = document.createElement("div");
      sec.className = "kitto-section";
      sec.innerHTML = `<div class="kitto-section-label">ワールド</div>`;
      const stickers = document.createElement("div");
      stickers.className = "kitto-stickers";
      for (const c of worlds) {
        const sticker = createSticker(c.label, "world", stickerIndex++);
        sticker.addEventListener("click", () =>
          insertChipToMemo(sticker, c.label, textarea, markerView, data, counter, maxLen),
        );
        stickers.appendChild(sticker);
      }
      sec.appendChild(stickers);
      inside.appendChild(sec);
    }

    if (people.length > 0) {
      const sec = document.createElement("div");
      sec.className = "kitto-section";
      sec.innerHTML = `<div class="kitto-section-label">人物</div>`;
      const stickers = document.createElement("div");
      stickers.className = "kitto-stickers";
      for (const c of people) {
        const sticker = createSticker(c.label, "person", stickerIndex++);
        sticker.addEventListener("click", () =>
          insertChipToMemo(sticker, c.label, textarea, markerView, data, counter, maxLen),
        );
        stickers.appendChild(sticker);
      }
      sec.appendChild(stickers);
      inside.appendChild(sec);
    }

    boardBox.appendChild(inside);
    board.appendChild(boardBox);

    lid.addEventListener("click", () => {
      board.classList.toggle("open");
    });

    return board;
  }

  // めもきっとシール1枚を生成する。index で 0.05 秒ずつ animationDelay をずらし、めくれ演出をずらす
  function createSticker(label: string, category: string, index: number): HTMLElement {
    const sticker = document.createElement("div");
    sticker.className = "kitto-sticker";
    sticker.dataset.cat = category;
    sticker.style.animationDelay = `${index * 0.05}s`;
    sticker.textContent = label;
    return sticker;
  }

  // シールがめくれてメモに張り付く演出 (300ms) の後、textarea に追記して即時保存 +
  // memokitto 由来の追記は自動マーカーに直結する (ワールド名/人名なので marker.rs が拾う)。
  //
  // L7-MemokittoRefresh: 追記後に `saveDayMemo` → `getDayFocusData` を await で
  //   refetch して memo_markers (自動マーカー) を最新化し、`renderMarkerText` を呼び直す。
  //   こうしないと、シール挿入直後の textarea は新文字列を表示するが、markerView の
  //   下線装飾は古い memo_markers のままで「貼ったばかりのチップに下線が付かない」現象になる。
  //   コストは IPC 1 回追加のみで 1 操作あたりの発生回数も低く許容範囲。
  function insertChipToMemo(
    chipEl: HTMLElement,
    text: string,
    textarea: HTMLTextAreaElement,
    markerView: HTMLElement,
    data: DayFocusData,
    counter: HTMLElement,
    maxLen: number,
  ): void {
    chipEl.classList.add("inserting");

    setTimeout(() => {
      chipEl.classList.remove("inserting");

      const current = textarea.value;
      const newVal = current ? `${current}\n${text}` : text;
      if (newVal.length > maxLen) return;
      textarea.value = newVal;
      counter.textContent = `${newVal.length} / ${maxLen}`;

      // まず旧マーカーで暫定描画 (体感の即時性を保つ)
      renderMarkerText(markerView, newVal, data.memo_markers, data.manual_markers);

      // 既存タイマー (renderMemo 内の scheduleMemoSave で登録された debounce) は
      // 即時 await 保存で代替するため必ず先に解除し、二重保存と古い値の上書きを防ぐ。
      if (memoSaveTimeout !== undefined) {
        clearTimeout(memoSaveTimeout);
        memoSaveTimeout = undefined;
      }
      pendingMemoSave = { date: data.date, getValue: () => textarea.value };

      // L7-MemokittoRefresh: 即時保存 → 再 fetch → マーカー更新 → 再描画。
      // failure 時は notifyMemoSaveError + pendingMemoSave を残して次回 flush に委ねる。
      void (async () => {
        try {
          const insertedTarget = pendingMemoSave;
          await saveDayMemo(data.date, textarea.value);
          // 保存成功時のみ pending を解除 (flushPendingMemo と同じガード)。
          // await 中に別経路 (input/composition) で pendingMemoSave が差し替わっていれば、
          // その新 pending は次回 debounce / flush に委ねる (= ここでは null 化しない)。
          if (pendingMemoSave === insertedTarget) {
            pendingMemoSave = null;
          }
          const fresh = await getDayFocusData(data.date);
          // 別日へ遷移していたら以降は捨てる
          if (focusedDate.get() !== data.date) return;
          data.memo_markers = fresh.memo_markers;
          data.manual_markers = fresh.manual_markers;
          renderMarkerText(markerView, textarea.value, data.memo_markers, data.manual_markers);
          wireMarkerContextMenu(markerView, data);
        } catch (e) {
          notifyMemoSaveError(e);
        }
      })();
    }, 300);
  }

  // 写真の全画面ビューア。前後ナビ・キーボード操作・Esc/オーバーレイクリックで閉じる。
  // closed フラグで close() の多重実行 (closeBtn クリック → overlay へ bubble) を抑止する。
  function openLightbox(photos: string[], startIndex: number): void {
    let current = startIndex;
    const overlay = document.createElement("div");
    overlay.className = "lightbox-overlay";

    const img = document.createElement("img");
    img.className = "lightbox-img";
    img.src = convertFilePath(photos[current]);

    const closeBtn = document.createElement("button");
    closeBtn.className = "lightbox-close";
    closeBtn.textContent = "✕";
    // Loop 9 D-I18N-A11y: 視覚記号 (✕) のみで意味を伝えていたため a11y ラベルを付与し、
    //   他モーダルの「閉じる」ボタンとアクセシブルネームを統一する。
    closeBtn.setAttribute("aria-label", MESSAGES.ui.actionClose);

    const prevBtn = document.createElement("button");
    prevBtn.className = "lightbox-nav prev";
    prevBtn.textContent = "‹";

    const nextBtn = document.createElement("button");
    nextBtn.className = "lightbox-nav next";
    nextBtn.textContent = "›";

    const counterEl = document.createElement("div");
    counterEl.className = "lightbox-counter";

    // 現在の写真とナビゲーションを更新する。
    // L5 Mem: convertFileSrc は asset:// URL を返すが、img.src を上書きする前に空文字で
    // 一旦切断しないと、前写真の decode キャッシュが現要素に紐づいたまま残り、リーク源になる。
    // src 属性を removeAttribute → 新規セットで参照を断ち切ってから次の URL を与える。
    function update(): void {
      img.removeAttribute("src");
      img.src = convertFilePath(photos[current]);
      counterEl.textContent = `${current + 1} / ${photos.length}`;
      prevBtn.style.display = current > 0 ? "" : "none";
      nextBtn.style.display = current < photos.length - 1 ? "" : "none";
    }

    prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      current--;
      update();
    });
    nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      current++;
      update();
    });

    // ライトボックスを閉じてイベントリスナーを解除する
    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      // L5 Mem: img.src を握ったまま DOM 切り離しに任せると、ブラウザ実装によっては
      // 直近の decode キャッシュが GC まで残る。明示的に src を外して参照を切る。
      img.removeAttribute("src");
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 300);
      // C3: addEventListener と同じ capture フラグで解除する
      document.removeEventListener("keydown", keyHandler, true);
    }

    // ライトボックスのキーボード操作を処理する
    // C3: focusedDate 解除の Esc handler と同居しないよう、capture 段階で受けて stopImmediatePropagation する
    function keyHandler(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
        return;
      }
      if (e.key === "ArrowLeft" && current > 0) {
        e.stopImmediatePropagation();
        current--;
        update();
      }
      if (e.key === "ArrowRight" && current < photos.length - 1) {
        e.stopImmediatePropagation();
        current++;
        update();
      }
    }

    overlay.addEventListener("click", close);
    img.addEventListener("click", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", keyHandler, true);
    // ページ unmount 時にライトボックスが開いたままでもリスナーが残らないよう subs に登録
    subs.add(() => close());

    overlay.appendChild(img);
    overlay.appendChild(closeBtn);
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(counterEl);
    document.body.appendChild(overlay);

    update();
    requestAnimationFrame(() => overlay.classList.add("visible"));
  }

  // ストア購読: focusedDate ↔ enterFocusMode/exitFocusMode、currentWeekStart 変化で再ロード
  // M8: subscribeImmediate を使い、初回値の補填と購読を 1 行で表現する
  // 先に currentWeekStart を登録して lastLoadWeek を確定させてから focusedDate を購読する (順序重要)
  subs.add(
    currentWeekStart.subscribeImmediate((_v, prev) => {
      // ユーザー操作で週を切替えた場合のみ focusedDate を解除 (初回 subscribeImmediate は prev === _v なのでスキップ)
      if (prev !== _v && focusedDate.get()) focusedDate.set(null);
      lastLoadWeek = loadWeek();
      void lastLoadWeek;
    }),
  );

  subs.add(
    focusedDate.subscribeImmediate((date, prev) => {
      // 日付切替時にも flush する (loadMemo 内で await されるためここでは fire-and-forget でも順序は保証される)
      if (prev && prev !== date) flushPendingMemo().catch(() => {});
      if (date) {
        // 直近 loadWeek 完了後に enterFocusMode (DOM 未描画段階での focused class 付与を避ける)
        void lastLoadWeek.then(() => {
          if (focusedDate.get() === date) enterFocusMode(date);
        });
      } else if (prev !== date) {
        // 初回値が null の場合 (prev === date === null) は exitFocusMode を呼ばない
        exitFocusMode();
      }
    }),
  );

  // 予定追加/削除によって notifications が更新されたら週を再描画
  subs.add(
    notifications.subscribe(() => {
      if (!focusedDate.get()) {
        lastLoadWeek = loadWeek();
        void lastLoadWeek;
      }
    }),
  );

  // M9: 設定変更 (時間表記やビュー時間帯) を表示に反映するため subscribeImmediate で購読する
  // 初回値は HomePage 構築時の各 get() で既に拾われているため、ここでは変更検知のみ意味を持つ
  subs.add(
    settings.subscribeImmediate((_v, prev) => {
      // 初回 (prev === _v) は何もしない: 既に renderLane / renderMemo が settings.get() を読んでいる
      if (Object.is(prev, _v)) return;
      // view_hour_start/end や memo_max_length 変更を再描画で反映
      if (!focusedDate.get()) {
        lastLoadWeek = loadWeek();
        void lastLoadWeek;
      } else {
        const d = focusedDate.get();
        if (d) void loadMemo(d);
        lastLoadWeek = loadWeek();
        void lastLoadWeek;
      }
    }),
  );

  // Keyboard
  const handler = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && focusedDate.get()) {
      focusedDate.set(null);
    }
    if (!focusedDate.get()) {
      if (e.key === "ArrowLeft") shiftWeek(-1);
      if (e.key === "ArrowRight") shiftWeek(1);
    }
  };
  document.addEventListener("keydown", handler);
  subs.add(() => document.removeEventListener("keydown", handler));

  // フォーカス中の Shift + ホイールでズーム調整 (passive: false にして preventDefault を効かせる)
  const wheelHandler = (e: WheelEvent): void => {
    if (!e.shiftKey || !focusedDate.get()) return;
    e.preventDefault();
    adjustZoom(e.deltaY > 0 ? 1 : -1);
  };
  laneBody.addEventListener("wheel", wheelHandler, { passive: false });
  subs.add(() => laneBody.removeEventListener("wheel", wheelHandler));

  // M8: 初回 loadWeek と pendingFocus 補填は currentWeekStart.subscribeImmediate / focusedDate.subscribeImmediate に集約済み
  return container;
}

// "YYYY-MM-DD" がローカル日付の今日と一致するかを判定する
function isToday(dateStr: string): boolean {
  const today = new Date();
  const [y, m, d] = dateStr.split("-").map(Number);
  return today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d;
}

// Loop 4 UX-05: 旧 `formatHour` ("H:MM") を utils/datetime の `formatHourMinute` ("HH:MM") に差し替えた。
// 旧実装は時を無パディングだったため、utils 側 `formatTime` (ゼロ埋め) と表記が揺れていた。
// import 別名 `formatHourMinute` を使うため、ここではローカル wrapper のみ残してシグネチャを維持する。
function formatHour(hour: number): string {
  return formatHourMinute(hour);
}

// Loop 4 UX-10: 旧 "Xh Ym" 英語表記を utils/datetime の日本語形式 `formatDuration` ("X時間Y分") に差し替え。
// import 衝突を避けるため別名 `fmtDurationJa` で取り込み、ここで wrap して既存の呼出箇所と互換にする。
function formatDuration(minutes: number): string {
  return fmtDurationJa(minutes);
}

// "#rrggbb" (7文字想定) と alpha から rgba(...) 文字列を組み立てる。
// Loop 7 UI 防御: 不正フォーマットや parseInt 失敗 (NaN) は wood-tone グレー fallback に巻き戻す。
// DB に空文字や旧フォーマットが残っていても CSS が "rgba(NaN, NaN, NaN, ...)" にならないようにする。
function hexToRgba(hex: string, alpha: number): string {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(168, 152, 128, ${alpha})`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(168, 152, 128, ${alpha})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Windows ローカルパスを Tauri 経由で読める asset:// URL に変換する
function convertFilePath(path: string): string {
  return convertFileSrc(path);
}

// 通知の scheduled_at から小数時刻 (hour + min/60) を抽出する。
// Loop 7 UI 防御: Invalid Date (例: 空文字や不正フォーマット) は getTime() が NaN になるため
// null を返し、呼出側でピン非表示にする (位置不定で画面端に飛ぶのを防ぐ)。
function parseNotifHour(isoStr: string): number | null {
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return null;
    return d.getHours() + d.getMinutes() / 60;
  } catch {
    return null;
  }
}

// innerHTML / title 属性に流す前の HTML 特殊文字エスケープ (& < > " を実体参照化)
