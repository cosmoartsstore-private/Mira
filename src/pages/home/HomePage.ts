import { getWeekLaneData, getDayFocusData, saveDayMemo, addManualMarker, removeManualMarker, getStartupInfo } from "../../api/commands";
import { convertFileSrc } from "@tauri-apps/api/core";
import { currentWeekStart, focusedDate, stellaConnected, settings, notifications, getMonday, Subscriptions } from "../../state/store";
import type { WeekLaneData, DayFocusData, MarkerSpan, ManualMarker, PhotoEntry, VisitPlayer } from "../../state/types";

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
        <p class="empty-state-message">STELLARecord との接続を確認しています…</p>
        <p class="empty-state-hint">STELLARecord がインストールされていることを確認してください。</p>
        <button class="empty-state-retry">再接続</button>
      </div>
    `;
    const retryBtn = container.querySelector<HTMLButtonElement>(".empty-state-retry");
    if (retryBtn) {
      retryBtn.addEventListener("click", async () => {
        retryBtn.disabled = true;
        retryBtn.textContent = "接続中…";
        try {
          const info = await getStartupInfo();
          stellaConnected.set(info.stella_connected);
          notifications.set(info.pending_notifications);
        } catch { /* */ }
        retryBtn.disabled = false;
        retryBtn.textContent = "再接続";
      });
    }
    return container;
  }

  // Back button (replaces week-nav in focus mode)
  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = "← 週に戻る";
  backBtn.addEventListener("click", () => focusedDate.set(null));

  // Page head
  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>Today</h1><span class="sub"></span>`;
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
  todayBtn.textContent = "今週";
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
  laneFoot.textContent = "✦ 日付ヘッダーをクリックすると詳細が開きます ✦";

  const zoomControls = document.createElement("div");
  zoomControls.className = "lane-zoom";
  const zoomLabel = document.createElement("span");
  zoomLabel.className = "zoom-label";
  zoomLabel.textContent = "6h";
  const zoomHint = document.createElement("span");
  zoomHint.className = "zoom-hint";
  zoomHint.textContent = "Shift + ホイールで拡縮";
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
  memoInner.innerHTML = '<div class="memo-empty">日付を選んでください<br>メモが表示されます</div>';
  memoPaper.appendChild(memoInner);

  homeLayout.appendChild(laneWrap);
  homeLayout.appendChild(memoPaper);

  container.appendChild(pageHead);
  container.appendChild(weekNav);
  container.appendChild(backBtn);
  container.appendChild(homeLayout);

  // loadGen: loadWeek() 内の各 await 後に gen 比較し、古い結果の renderLane を抑止する
  let loadGen = 0;
  // 直近 renderLane が決定した表示時間帯（フォーカスモードのグリッド線計算で使う）
  let lastHourStart = 0;
  let lastHourEnd = 24;
  let lastTotalHours = 24;
  // フォーカス時のズーム倍率（一度に何時間ぶんを表示するか）。adjustZoom で steps を行き来。
  let visibleHours = 6;

  // 週ナビと「week of ...」サブラベルの日付範囲文字列を更新する
  function updateSubLabel(): void {
    const [y, m, d] = currentWeekStart.get().split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 6);
    const fmt = (dt: Date) => `${dt.getMonth() + 1}/${dt.getDate()}`;
    subLabel.textContent = `week of ${fmt(start)} – ${fmt(end)}`;
    weekLabel.textContent = `${start.getFullYear()}年 ${fmt(start)} – ${fmt(end)}`;
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
    const gen = ++loadGen;
    updateSubLabel();

    // フェードアウト中（120ms）に視覚的に切替えを示す
    laneWrap.classList.add("lane-switching");
    await new Promise((r) => setTimeout(r, 120));
    if (gen !== loadGen) return;

    laneHeader.innerHTML = "";
    laneBody.innerHTML = '<div class="loading" style="grid-column: 1/-1;">読み込み中…</div>';

    try {
      const data: WeekLaneData = await getWeekLaneData(currentWeekStart.get());
      if (gen !== loadGen) return;
      renderLane(data);
    } catch (e) {
      if (gen !== loadGen) return;
      laneBody.innerHTML = `<div class="memo-empty" style="grid-column: 1/-1;">データの読み込みに失敗しました</div>`;
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
    const cfgStart = (s.view_hour_start ?? 0);
    const cfgEnd = (s.view_hour_end ?? 24);
    let hour_start = data.hour_start;
    let hour_end = data.hour_end;
    if (cfgEnd > cfgStart) {
      hour_start = Math.max(hour_start, cfgStart);
      hour_end = Math.min(hour_end, cfgEnd);
      if (hour_end <= hour_start) {
        hour_start = cfgStart;
        hour_end = cfgEnd;
      }
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
        badge.style.cssText = "position:absolute;bottom:2px;right:2px;font-size:10px;padding:1px 4px;border-radius:3px;background:rgba(140,90,90,0.18);color:#a55;pointer-events:none;";
        col.style.position = col.style.position || "relative";
        col.appendChild(badge);
      }

      // Notification pins for this day
      const dayNotifs = notifications.get().filter((n) => n.scheduled_at.startsWith(lane.date));
      for (const notif of dayNotifs) {
        const pin = document.createElement("div");
        pin.className = "notif-pin";
        const notifHour = parseNotifHour(notif.scheduled_at);
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

    loadMemo(date);

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
    laneHeader.querySelectorAll(".day-head.focused").forEach((el) => el.classList.remove("focused"));
    laneBody.style.removeProperty("--zoom-scale");

    const timeAxisEl = laneBody.querySelector<HTMLElement>(".time-axis");
    if (timeAxisEl) timeAxisEl.style.height = "";
    laneBody.querySelectorAll<HTMLElement>(".day-lane").forEach((el) => {
      el.style.height = "";
      el.classList.remove("focused");
    });
    laneBody.querySelectorAll(".focus-grid-line").forEach((el) => el.remove());
    laneBody.scrollTop = 0;

    memoInner.innerHTML = '<div class="memo-empty">日付を選んでください<br>メモが表示されます</div>';
  }

  // memoGen: loadMemo の await 中に別日が選ばれた場合に古い描画を破棄するための世代カウンタ
  let memoGen = 0;
  // メモ入力 1 秒後に走らせる自動保存タイマー。ページ破棄時に必ず clearTimeout する。
  let memoSaveTimeout: number | undefined;
  let pendingMemoSave: { date: string; getValue: () => string } | null = null;
  // unmount 時に未保存のメモを flush する
  subs.add(() => {
    if (memoSaveTimeout) {
      clearTimeout(memoSaveTimeout);
      memoSaveTimeout = undefined;
      if (pendingMemoSave) {
        const { date, getValue } = pendingMemoSave;
        saveDayMemo(date, getValue()).catch(() => {});
        pendingMemoSave = null;
      }
    }
  });

  // 日付切替時に未保存のメモを flush する (保存完了まで await できるよう async)
  async function flushPendingMemo(): Promise<void> {
    if (!memoSaveTimeout && !pendingMemoSave) return;
    if (memoSaveTimeout) {
      clearTimeout(memoSaveTimeout);
      memoSaveTimeout = undefined;
    }
    if (pendingMemoSave) {
      const { date, getValue } = pendingMemoSave;
      pendingMemoSave = null;
      try {
        await saveDayMemo(date, getValue());
      } catch {
        // 保存失敗は致命ではないので握り潰す
      }
    }
  }

  // 指定日の詳細データを取得して renderMemo に渡す。loadGen と同じ理由で世代比較する。
  async function loadMemo(date: string): Promise<void> {
    await flushPendingMemo();
    const gen = ++memoGen;
    memoInner.innerHTML = '<div class="loading">読み込み中…</div>';
    try {
      const data = await getDayFocusData(date);
      if (gen !== memoGen) return;
      renderMemo(data);
    } catch (e) {
      if (gen !== memoGen) return;
      memoInner.innerHTML = `<div class="memo-empty">${e}</div>`;
    }
  }

  // 訪問ブロッククリックで写真をフィルタするため、最新の photos 要素と全写真を保持しておく
  let activePhotosEl: HTMLElement | null = null;
  let allPhotos: PhotoEntry[] = [];

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

    const maxLen = settings.get().memo_max_length;
    const memoText = data.memo || "";

    const markerView = document.createElement("div");
    markerView.className = "memo-marker-view";
    renderMarkerText(markerView, memoText, data.memo_markers, data.manual_markers);
    wireMarkerContextMenu(markerView, data);

    const textarea = document.createElement("textarea");
    textarea.className = "memo-textarea";
    textarea.placeholder = "今日のことを書き留める…";
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

    textarea.addEventListener("input", () => {
      counter.textContent = `${textarea.value.length} / ${maxLen}`;
      clearTimeout(memoSaveTimeout);
      pendingMemoSave = { date: data.date, getValue: () => textarea.value };
      memoSaveTimeout = window.setTimeout(() => {
        saveDayMemo(data.date, textarea.value).catch(() => {});
        pendingMemoSave = null;
        memoSaveTimeout = undefined;
      }, 1000);
    });

    noteCard.appendChild(markerView);
    noteCard.appendChild(textarea);
    noteCard.appendChild(counter);
    memoInner.appendChild(noteCard);

    // Memokitto
    const kittoChips = data.memokitto;
    if (kittoChips.length > 0) {
      memoInner.appendChild(renderMemokittoTray(kittoChips, textarea, markerView, data, counter, maxLen));
    }

    const statsEl = document.createElement("div");
    statsEl.className = "memo-stats";
    statsEl.innerHTML = `
      <div class="memo-stat"><div class="lbl">Stay</div><div class="val"><span class="num">${formatDuration(data.total_duration_min)}</span></div></div>
      <div class="memo-stat"><div class="lbl">People</div><div class="val"><span class="num">${data.people_count}</span>人</div></div>
      <div class="memo-stat"><div class="lbl">Photos</div><div class="val"><span class="num">${data.photo_count}</span>枚</div></div>
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
      photosEl.innerHTML = `<div class="lbl">Photos <span class="count">0枚</span></div>`;
      return;
    }
    photosEl.innerHTML = `<div class="lbl">Photos <span class="count">${photos.length}枚</span></div>`;
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

    focusedLane.querySelectorAll(".visit-block").forEach((block, idx) => {
      block.addEventListener("click", (e) => {
        e.stopPropagation();
        const visit = data.visits[idx];
        if (!visit || !activePhotosEl) return;

        const wasActive = block.classList.contains("visit-selected");
        focusedLane.querySelectorAll(".visit-block.visit-selected").forEach((b) => b.classList.remove("visit-selected"));

        const existingJoin = memoInner.querySelector(".join-record");
        if (existingJoin) existingJoin.remove();

        if (wasActive) {
          renderPhotoGrid(activePhotosEl, allPhotos);
        } else {
          block.classList.add("visit-selected");
          const filtered = allPhotos.filter((p) => p.hour >= visit.start_hour && p.hour < visit.end_hour);
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
  // start/end は UTF-16 コードユニット位置 (バックエンドの marker.rs と整合)。
  // 重複範囲はソート後の dedupe で 1 つだけ採用し、重なる場合は先着優先（cursor で防御）。
  function renderMarkerText(
    el: HTMLElement,
    text: string,
    autoMarkers: MarkerSpan[],
    manualMarkers: ManualMarker[]
  ): void {
    el.innerHTML = "";
    if (!text) return;

    const marks: UnderlineMark[] = [];
    for (const m of autoMarkers) {
      if (m.start < m.end && m.start < text.length && m.end <= text.length) {
        marks.push({ start: m.start, end: m.end, kind: m.kind, title: m.text });
      }
    }
    for (const m of manualMarkers) {
      if (m.start < m.end && m.start < text.length && m.end <= text.length) {
        marks.push({ start: m.start, end: m.end, kind: m.color, title: "", markerId: m.id });
      }
    }

    if (marks.length === 0) {
      el.textContent = text;
      return;
    }

    const sorted = marks.sort((a, b) => a.start - b.start);
    const deduped: UnderlineMark[] = [];
    for (const m of sorted) {
      if (!deduped.some((d) => d.start === m.start && d.end === m.end)) {
        deduped.push(m);
      }
    }

    let cursor = 0;
    for (const m of deduped) {
      if (m.start < cursor) continue;
      if (m.start > cursor) {
        el.appendChild(document.createTextNode(text.slice(cursor, m.start)));
      }
      const span = document.createElement("span");
      span.className = "marker-underline";
      span.dataset.kind = m.kind;
      if (m.markerId !== undefined) span.dataset.markerId = String(m.markerId);
      span.textContent = text.slice(m.start, m.end);
      if (m.title) span.title = m.title;
      el.appendChild(span);
      cursor = m.end;
    }
    if (cursor < text.length) {
      el.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  // 右クリックで色選択メニューを出し、選択範囲に手動マーカーを付ける/削除する。
  // 既存マーカーの上で右クリックした時のみ「マーカーを消す」項目を追加する。
  function wireMarkerContextMenu(markerView: HTMLElement, data: DayFocusData): void {
    markerView.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // 同時に複数メニューが開かないように既存メニューを破棄
      document.querySelectorAll(".marker-context-menu").forEach((m) => m.remove());

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !markerView.contains(sel.anchorNode)) return;

      const range = sel.getRangeAt(0);
      const fullText = data.memo || "";
      const offsets = getSelectionOffsets(markerView, range);
      if (offsets.start >= offsets.end) return;

      const clickedMarker = (e.target as HTMLElement).closest("[data-marker-id]") as HTMLElement | null;

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
          const id = await addManualMarker(data.date, offsets.start, offsets.end, c.key).catch(() => null);
          if (id !== null) {
            data.manual_markers.push({ id, start: offsets.start, end: offsets.end, color: c.key });
            renderMarkerText(markerView, fullText, data.memo_markers, data.manual_markers);
            wireMarkerContextMenu(markerView, data);
          }
        });
        menu.appendChild(item);
      }

      if (clickedMarker) {
        const markerId = Number(clickedMarker.dataset.markerId);
        const sep = document.createElement("div");
        sep.className = "marker-menu-sep";
        menu.appendChild(sep);
        const removeItem = document.createElement("div");
        removeItem.className = "marker-menu-item remove";
        removeItem.textContent = "マーカーを消す";
        removeItem.addEventListener("click", async () => {
          menu.remove();
          await removeManualMarker(markerId).catch(() => {});
          data.manual_markers = data.manual_markers.filter((m) => m.id !== markerId);
          renderMarkerText(markerView, fullText, data.memo_markers, data.manual_markers);
          wireMarkerContextMenu(markerView, data);
        });
        menu.appendChild(removeItem);
      }

      document.body.appendChild(menu);

      // 外側クリックでメニューを閉じる。setTimeout(0) を挟むのは、コンテキストメニューを
      // 出すきっかけになった click イベントが先に bubble して即閉じてしまうのを避けるため。
      const dismiss = () => {
        menu.remove();
        document.removeEventListener("click", dismiss);
      };
      setTimeout(() => document.addEventListener("click", dismiss), 0);
    });
  }

  // container 内のテキスト選択範囲を UTF-16 文字オフセットに変換する。
  // 「container 先頭から range 端まで」の Range を toString() して .length を取る。
  // JS 文字列は UTF-16 なので .length = UTF-16 コードユニット数となり、
  // バックエンド (marker.rs) が返す UTF-16 オフセットと一致する。
  function getSelectionOffsets(container: HTMLElement, range: Range): { start: number; end: number } {
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;

    const preEnd = document.createRange();
    preEnd.selectNodeContents(container);
    preEnd.setEnd(range.endContainer, range.endOffset);
    const end = preEnd.toString().length;

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
    maxLen: number
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
      sec.innerHTML = `<div class="kitto-section-label">worlds</div>`;
      const stickers = document.createElement("div");
      stickers.className = "kitto-stickers";
      for (const c of worlds) {
        const sticker = createSticker(c.label, "world", stickerIndex++);
        sticker.addEventListener("click", () => insertChipToMemo(sticker, c.label, textarea, markerView, data, counter, maxLen));
        stickers.appendChild(sticker);
      }
      sec.appendChild(stickers);
      inside.appendChild(sec);
    }

    if (people.length > 0) {
      const sec = document.createElement("div");
      sec.className = "kitto-section";
      sec.innerHTML = `<div class="kitto-section-label">people</div>`;
      const stickers = document.createElement("div");
      stickers.className = "kitto-stickers";
      for (const c of people) {
        const sticker = createSticker(c.label, "person", stickerIndex++);
        sticker.addEventListener("click", () => insertChipToMemo(sticker, c.label, textarea, markerView, data, counter, maxLen));
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

  // シールがめくれてメモに張り付く演出 (300ms) の後、textarea に追記して自動保存タイマーを再セット
  function insertChipToMemo(
    chipEl: HTMLElement,
    text: string,
    textarea: HTMLTextAreaElement,
    markerView: HTMLElement,
    data: DayFocusData,
    counter: HTMLElement,
    maxLen: number
  ): void {
    chipEl.classList.add("inserting");

    setTimeout(() => {
      chipEl.classList.remove("inserting");

      const current = textarea.value;
      const newVal = current ? `${current}\n${text}` : text;
      if (newVal.length > maxLen) return;
      textarea.value = newVal;
      counter.textContent = `${newVal.length} / ${maxLen}`;

      renderMarkerText(markerView, newVal, data.memo_markers, data.manual_markers);

      clearTimeout(memoSaveTimeout);
      pendingMemoSave = { date: data.date, getValue: () => textarea.value };
      memoSaveTimeout = window.setTimeout(() => {
        saveDayMemo(data.date, textarea.value).catch(() => {});
        pendingMemoSave = null;
        memoSaveTimeout = undefined;
      }, 1000);
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

    const prevBtn = document.createElement("button");
    prevBtn.className = "lightbox-nav prev";
    prevBtn.textContent = "‹";

    const nextBtn = document.createElement("button");
    nextBtn.className = "lightbox-nav next";
    nextBtn.textContent = "›";

    const counterEl = document.createElement("div");
    counterEl.className = "lightbox-counter";

    // 現在の写真とナビゲーションを更新する
    function update(): void {
      img.src = convertFilePath(photos[current]);
      counterEl.textContent = `${current + 1} / ${photos.length}`;
      prevBtn.style.display = current > 0 ? "" : "none";
      nextBtn.style.display = current < photos.length - 1 ? "" : "none";
    }

    prevBtn.addEventListener("click", (e) => { e.stopPropagation(); current--; update(); });
    nextBtn.addEventListener("click", (e) => { e.stopPropagation(); current++; update(); });

    let closed = false;

    // ライトボックスを閉じてイベントリスナーを解除する
    let closed = false;
    function close(): void {
      if (closed) return;
      closed = true;
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 300);
      document.removeEventListener("keydown", keyHandler);
    }

    // ライトボックスのキーボード操作を処理する
    function keyHandler(e: KeyboardEvent): void {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft" && current > 0) { current--; update(); }
      if (e.key === "ArrowRight" && current < photos.length - 1) { current++; update(); }
    }

    overlay.addEventListener("click", close);
    img.addEventListener("click", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", keyHandler);
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
  subs.add(
    focusedDate.subscribe((date, prev) => {
      // 日付切替時にも flush する (loadMemo 内で await されるためここでは fire-and-forget でも順序は保証される)
      if (prev && prev !== date) flushPendingMemo().catch(() => {});
      if (date) {
        enterFocusMode(date);
      } else {
        exitFocusMode();
      }
    })
  );

  subs.add(
    currentWeekStart.subscribe(() => {
      if (focusedDate.get()) focusedDate.set(null);
      loadWeek();
    })
  );

  // 予定追加/削除によって notifications が更新されたら週を再描画
  subs.add(
    notifications.subscribe(() => {
      if (!focusedDate.get()) loadWeek();
    })
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

  // Store.subscribe は登録時に発火しないため、既にセット済みの focusedDate を週ロード後に拾う
  const pendingFocus = focusedDate.get();
  loadWeek().then(() => {
    if (pendingFocus && focusedDate.get() === pendingFocus) {
      enterFocusMode(pendingFocus);
    }
  });
  return container;
}

// "YYYY-MM-DD" がローカル日付の今日と一致するかを判定する
function isToday(dateStr: string): boolean {
  const today = new Date();
  const [y, m, d] = dateStr.split("-").map(Number);
  return today.getFullYear() === y && today.getMonth() + 1 === m && today.getDate() === d;
}

// 小数時刻 (14.5 など) を "H:MM" 形式に整形する。24+ は深夜越え扱いで -24 して 0..23 に丸める。
function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const display = h >= 24 ? h - 24 : h;
  return `${display}:${m.toString().padStart(2, "0")}`;
}

// 分数を "Xh Ym" (1時間未満なら "Ym") に整形する
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// "#rrggbb" (7文字想定) と alpha から rgba(...) 文字列を組み立てる
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Windows ローカルパスを Tauri 経由で読める asset:// URL に変換する
function convertFilePath(path: string): string {
  return convertFileSrc(path);
}

// 通知の scheduled_at から小数時刻 (hour + min/60) を抽出する。失敗時は 0
function parseNotifHour(isoStr: string): number {
  try {
    const d = new Date(isoStr);
    return d.getHours() + d.getMinutes() / 60;
  } catch {
    return 0;
  }
}

// innerHTML / title 属性に流す前の HTML 特殊文字エスケープ (& < > " を実体参照化)
function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}