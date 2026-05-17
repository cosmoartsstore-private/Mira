import {
  getMonthData,
  addEvent,
  removeEvent,
  refreshNotifications,
  updateCalendarEvent,
} from "@/api/commands";
import {
  currentMonth,
  activeTab,
  currentWeekStart,
  focusedDate,
  notifications,
  settings,
  Subscriptions,
} from "@/state/store";
import { getJapaneseHolidays } from "@/utils/holidays";
import { confirmDialog } from "@/utils/confirmDialog";
import { showToast } from "@/utils/toast";
import { escapeHtml as esc, errMessage } from "@/utils/html";
import { MESSAGES } from "@/utils/messages";
import type { CalendarEvent } from "@/state/types";

// 1 セルあたりに直接表示する予定タグの最大件数。これを超えたぶんは "+N 件" の
// 集約タグで隠し、クリックで全件リストポップアップを開く (M19 同一日複数予定崩壊対策)。
const MAX_VISIBLE_EVENTS_PER_DAY = 3;

// 新規予定追加モーダルのデフォルト通知タイミング (分前) は MiraSettings に統合済。
// SettingsPage で変更すると DB 保存 → settings ストア更新の経路で全 subscriber に反映される。
// `settings.get().remind_minutes_before_default` を都度参照することで、モーダル表示時点の
// 最新値を取得する (Loop 9 R2-M-20 で localStorage キャッシュ撤去)。

// "YYYY-MM-DD HH:MM[:SS]" 形式の日時文字列が現在時刻より過去かを判定する (M20)。
// パースできない場合は false (過去扱いしない) を返して呼出側の安全側に倒す。
function isPastDateTime(scheduledAt: string): boolean {
  // SQLite 形式 ("YYYY-MM-DD HH:MM:SS") を Date が確実に解釈できる形に正規化する
  const normalized = scheduledAt.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

// 月別カレンダー。月内のアクティブ日 (訪問あり) と祝日・予定を表示する。
// グリッドの曜日順は **月曜始まり** (月..日)。データ層 (HomePage / state/store) も同じ月曜始まり週で動く。
// アクティブ日クリック時は ISO 週の月曜日 (日曜=0 を 6 にオフセット) を currentWeekStart に渡す。
export function CalendarPage(subs: Subscriptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "calendar-page";

  // 現在表示中の popup の外側クリック dismiss リスナーを束ねる AbortController。
  // 新 popup を出すたびに旧 popup の dismiss を一括 abort し、複数 popup を順に開いたときの
  // dismiss リスナー累積 (race で旧 popup の dismiss が新 popup を閉じる) を防ぐ。
  let popupDismissCtrl: AbortController | null = null;

  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>カレンダー</h1><span class="sub">過去の記録を辿る</span>`;

  const monthNav = document.createElement("div");
  monthNav.className = "cal-month-nav";

  const prevBtn = document.createElement("button");
  prevBtn.className = "cal-arrow";
  prevBtn.textContent = "‹";
  prevBtn.addEventListener("click", () => shiftMonth(-1));

  const monthLabel = document.createElement("div");
  monthLabel.className = "cal-month-name";

  const nextBtn = document.createElement("button");
  nextBtn.className = "cal-arrow";
  nextBtn.textContent = "›";
  nextBtn.addEventListener("click", () => shiftMonth(1));

  monthNav.appendChild(prevBtn);
  monthNav.appendChild(monthLabel);
  monthNav.appendChild(nextBtn);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  const legend = document.createElement("div");
  legend.className = "cal-legend";
  legend.innerHTML =
    '活動した日<span class="legend-dot"></span>・ 祝日<span class="legend-dot holiday"></span>・ 予定<span class="legend-dot event"></span>';

  container.appendChild(pageHead);
  container.appendChild(monthNav);
  container.appendChild(grid);
  container.appendChild(legend);

  // 上部の年・月ラベル ("2026年 4月" のような表示) を currentMonth の値で更新する
  function updateLabel(): void {
    const { year, month } = currentMonth.get();
    const monthNames = [
      "1月",
      "2月",
      "3月",
      "4月",
      "5月",
      "6月",
      "7月",
      "8月",
      "9月",
      "10月",
      "11月",
      "12月",
    ];
    monthLabel.innerHTML = `<span class="year">${year}年</span>${monthNames[month - 1]}`;
  }

  // 現在月のアクティブ日とイベントをバックエンドから取得し renderGrid に流す。
  // 取得失敗時も空データでグリッドだけは描画して UI を壊さない。
  async function loadMonth(): Promise<void> {
    const { year, month } = currentMonth.get();
    updateLabel();
    try {
      const data = await getMonthData(year, month);
      renderGrid(year, month, data.active_days, data.events);
    } catch {
      renderGrid(year, month, [], []);
    }
  }

  // 予定追加/削除後に notifications をサーバーから再取得してストアに反映する
  async function refreshNotificationsStore(): Promise<void> {
    try {
      const list = await refreshNotifications();
      notifications.set(list);
    } catch {
      /* */
    }
  }

  // カレンダーグリッドに日付セルを描画する
  function renderGrid(
    year: number,
    month: number,
    activeDays: number[],
    events: CalendarEvent[],
  ): void {
    grid.innerHTML = "";
    // 表示は日本語1文字、CSS class は土/日の色付け用に saturday/sunday を保持する
    const weekdays: { label: string; cls?: "saturday" | "sunday" }[] = [
      { label: "月" },
      { label: "火" },
      { label: "水" },
      { label: "木" },
      { label: "金" },
      { label: "土", cls: "saturday" },
      { label: "日", cls: "sunday" },
    ];
    for (const wd of weekdays) {
      const head = document.createElement("div");
      head.className = "cal-head";
      if (wd.cls) head.classList.add(wd.cls);
      head.textContent = wd.label;
      grid.appendChild(head);
    }

    // 月曜=0 列, 火曜=1 列, ..., 日曜=6 列に揃えるためのオフセット計算
    let offset = new Date(year, month - 1, 1).getDay() - 1;
    if (offset < 0) offset = 6;

    for (let i = 0; i < offset; i++) {
      const empty = document.createElement("div");
      empty.className = "cal-day empty";
      grid.appendChild(empty);
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const activeSet = new Set(activeDays);
    const today = new Date();
    const holidays = getJapaneseHolidays(year, month);
    const holidayMap = new Map(holidays.map((h) => [h.day, h.name]));

    const eventsByDay = new Map<number, CalendarEvent[]>();
    for (const evt of events) {
      const dayPart = evt.scheduled_at.split(/[-T ]/)[2];
      if (!dayPart) continue;
      const day = parseInt(dayPart, 10);
      if (Number.isNaN(day)) continue;
      if (!eventsByDay.has(day)) eventsByDay.set(day, []);
      eventsByDay.get(day)!.push(evt);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement("div");
      cell.className = "cal-day";

      const isActive = activeSet.has(d);
      const holidayName = holidayMap.get(d);
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      const dayEvents = eventsByDay.get(d) ?? [];

      if (!isActive && !holidayName && dayEvents.length === 0) cell.classList.add("no-data");
      if (dow === 0) cell.classList.add("sunday");
      if (dow === 6) cell.classList.add("saturday");
      if (holidayName) cell.classList.add("holiday");
      if (today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === d) {
        cell.classList.add("today");
      }

      const numEl = document.createElement("div");
      numEl.className = "num";
      numEl.textContent = String(d);
      cell.appendChild(numEl);

      if (holidayName) {
        const hlabel = document.createElement("div");
        hlabel.className = "holiday-name";
        hlabel.textContent = holidayName;
        cell.appendChild(hlabel);
      }

      if (isActive) {
        const dot = document.createElement("div");
        dot.className = "dot";
        cell.appendChild(dot);
      }

      // 最大 MAX_VISIBLE_EVENTS_PER_DAY 件まで個別タグ、超過分は "+N 件" 集約タグで隠す。
      // 集約タグをクリックすると全件リストポップアップ (showEventListPopup) を開く。
      const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS_PER_DAY);
      const hidden = dayEvents.slice(MAX_VISIBLE_EVENTS_PER_DAY);

      for (const evt of visible) {
        const tag = document.createElement("div");
        tag.className = "cal-event-tag";
        const time = evt.scheduled_at.split(/[ T]/)[1]?.slice(0, 5) || "";
        tag.textContent = `${time} ${evt.title}`;
        tag.title = `${evt.title} (${evt.remind_minutes_before}分前通知)`;
        tag.addEventListener("click", (e) => {
          e.stopPropagation();
          showEventPopup(evt, cell);
        });
        cell.appendChild(tag);
      }

      if (hidden.length > 0) {
        const more = document.createElement("div");
        more.className = "cal-event-tag cal-event-more";
        more.textContent = `+${hidden.length} 件`;
        more.title = "クリックで全予定を表示";
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          showEventListPopup(dayEvents, cell);
        });
        cell.appendChild(more);
      }

      // セルクリックの分岐:
      //  - アクティブ日 (訪問あり) かつ予定なし → HomePage のフォーカス表示へ飛ぶ
      //  - それ以外 (空き日 / 既存予定あり) → 予定追加フォームを開く
      // HomePage / currentWeekStart は**月曜始まり**週で動くため、ここで該当日の月曜を求めて渡す
      // (日曜=0 → 6 オフセット、その他は day-1 を引く / getMonday() と同じ ISO 週ロジック)。
      cell.addEventListener("click", () => {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (isActive && dayEvents.length === 0) {
          const dayOfWeek = new Date(year, month - 1, d).getDay();
          const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          const weekStart = new Date(year, month - 1, d - mondayOffset);
          const wy = weekStart.getFullYear();
          const wm = String(weekStart.getMonth() + 1).padStart(2, "0");
          const wd2 = String(weekStart.getDate()).padStart(2, "0");
          currentWeekStart.set(`${wy}-${wm}-${wd2}`);
          focusedDate.set(dateStr);
          activeTab.set("home");
        } else {
          showAddEventForm(dateStr, cell);
        }
      });

      grid.appendChild(cell);
    }
  }

  // 予定追加用ポップアップを anchor (=セル) の上に配置する。Enter で保存、Esc でキャンセル。
  // setTimeout(0) で外側クリック検知を1tick遅らせ、表示の起因となったクリックで即閉じるのを防ぐ。
  function showAddEventForm(date: string, anchor: HTMLElement): void {
    closePopups();

    const defaultRemind = settings.get().remind_minutes_before_default;
    const popup = document.createElement("div");
    popup.className = "cal-popup";

    // a11y: checkbox に一意 id を採番し label[for] と紐付ける (DOM 重複防止のためポップアップ毎にユニーク化)
    const recurringId = `cal-recurring-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    popup.innerHTML = `
      <div class="cal-popup-title">予定を追加</div>
      <input class="cal-popup-input" type="text" placeholder="${MESSAGES.placeholders.eventTitle}" aria-label="${MESSAGES.ariaLabels.eventTitle}" />
      <div class="cal-popup-row">
        <input class="cal-popup-time" type="time" value="12:00" aria-label="${MESSAGES.ariaLabels.eventStartTime}" />
        <select class="cal-popup-remind" aria-label="${MESSAGES.ariaLabels.eventReminder}">
          ${[5, 10, 15, 20, 30, 60]
            .map(
              (m) =>
                `<option value="${m}"${m === defaultRemind ? " selected" : ""}>${
                  m === 60 ? "1時間前" : `${m}分前`
                }</option>`,
            )
            .join("")}
        </select>
      </div>
      <label class="cal-popup-recurring" for="${recurringId}">
        <input id="${recurringId}" class="cal-popup-recurring-input" type="checkbox" />
        <span>毎週繰り返す</span>
      </label>
      <div class="cal-popup-actions">
        <button class="cal-popup-cancel">キャンセル</button>
        <button class="cal-popup-save">追加</button>
      </div>
    `;

    anchor.appendChild(popup);
    const input = popup.querySelector<HTMLInputElement>(".cal-popup-input")!;
    const saveBtn = popup.querySelector<HTMLElement>(".cal-popup-save")!;
    input.focus();

    popup.querySelector(".cal-popup-cancel")!.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.remove();
    });

    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const title = input.value.trim();
      if (!title) return;
      const time = popup.querySelector<HTMLInputElement>(".cal-popup-time")!.value;
      const remind = Number(popup.querySelector<HTMLSelectElement>(".cal-popup-remind")!.value);
      const isRecurring = popup.querySelector<HTMLInputElement>(
        ".cal-popup-recurring-input",
      )!.checked;
      const scheduledAt = `${date} ${time}:00`;
      // M20: 過去日時の予定は許容するが、保存前に警告 toast を出す。
      // 繰り返しは「過去開始の週次」が普通にあり得るためチェック対象外。
      if (!isRecurring && isPastDateTime(scheduledAt)) {
        showToast({
          title: MESSAGES.warns.eventPastAddTitle,
          body: MESSAGES.warns.eventPastBody,
          kind: "warn",
        });
      }
      // L5 連打防止: 二重送信で同一予定が重複登録されるのを防ぐ。
      // disabled は try の外側で立て、finally で popup 未破棄時のみ解除する。
      (saveBtn as HTMLButtonElement).disabled = true;
      try {
        await addEvent(title, scheduledAt, remind, isRecurring, isRecurring ? "weekly" : null);
        popup.remove();
        await loadMonth();
        await refreshNotificationsStore();
      } catch (err) {
        showToast({
          title: MESSAGES.errors.eventAddFailed,
          body: errMessage(err),
          kind: "error",
        });
      } finally {
        // popup が DOM から除去済み (成功ケース) なら disabled 解除は無意味だが、
        // 失敗で popup が残っているケースのため必ず解除する
        if (popup.isConnected) (saveBtn as HTMLButtonElement).disabled = false;
      }
    });

    // L5: input keydown を popup の AbortController.signal に紐付ける (popup remove 時に自動 unregister)
    const inputKeyCtrl = new AbortController();
    input.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") saveBtn.click();
        if (e.key === "Escape") popup.remove();
      },
      { signal: inputKeyCtrl.signal },
    );

    popup.addEventListener("click", (e) => e.stopPropagation());

    registerDismiss(popup, inputKeyCtrl);
  }

  // 既存予定タグのクリックで詳細・編集・削除ボタン付きポップアップを開く
  function showEventPopup(evt: CalendarEvent, anchor: HTMLElement): void {
    closePopups();

    const time = evt.scheduled_at.split(/[ T]/)[1]?.slice(0, 5) || "";
    const recurringLabel = evt.recurrence_kind === "weekly" ? " ・ 毎週" : "";
    const popup = document.createElement("div");
    popup.className = "cal-popup";
    popup.innerHTML = `
      <div class="cal-popup-title">${esc(evt.title)}</div>
      <div class="cal-popup-detail">${time} ・ ${evt.remind_minutes_before}分前通知${recurringLabel}</div>
      <div class="cal-popup-actions">
        <button class="cal-popup-edit">編集</button>
        <button class="cal-popup-delete">削除</button>
      </div>
    `;

    anchor.appendChild(popup);

    popup.querySelector(".cal-popup-edit")!.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.remove();
      showEditEventForm(evt, anchor);
    });

    popup.querySelector(".cal-popup-delete")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await confirmDialog(`予定「${evt.title}」を削除しますか？`);
      if (!ok) return;
      try {
        await removeEvent(evt.id);
        popup.remove();
        await loadMonth();
        await refreshNotificationsStore();
      } catch (err) {
        showToast({
          title: MESSAGES.errors.eventDeleteFailed,
          body: errMessage(err),
          kind: "error",
        });
      }
    });

    popup.addEventListener("click", (e) => e.stopPropagation());

    registerDismiss(popup);
  }

  // 既存予定の編集モーダル。新規追加フォーム (showAddEventForm) と同じ構造で
  // updateCalendarEvent コマンドを呼ぶ。日付は scheduled_at の日付部分を type=date 入力で
  // 編集可能にし、別日への移動も許容する。
  function showEditEventForm(evt: CalendarEvent, anchor: HTMLElement): void {
    closePopups();

    const datePart = evt.scheduled_at.split(/[ T]/)[0] ?? "";
    const timePart = evt.scheduled_at.split(/[ T]/)[1]?.slice(0, 5) || "12:00";
    const isWeekly = evt.recurrence_kind === "weekly";
    const remindOptions = [5, 10, 15, 20, 30, 60];

    const popup = document.createElement("div");
    popup.className = "cal-popup cal-popup-edit-form";
    // a11y: checkbox に一意 id を採番し label[for] と紐付ける (DOM 重複防止のためポップアップ毎にユニーク化)
    const recurringId = `cal-recurring-edit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    popup.innerHTML = `
      <div class="cal-popup-title">予定を編集</div>
      <input class="cal-popup-input" type="text" value="${esc(evt.title)}" placeholder="${MESSAGES.placeholders.eventTitle}" aria-label="${MESSAGES.ariaLabels.eventTitle}" />
      <div class="cal-popup-row">
        <input class="cal-popup-date" type="date" value="${esc(datePart)}" aria-label="${MESSAGES.ariaLabels.eventDate}" />
      </div>
      <div class="cal-popup-row">
        <input class="cal-popup-time" type="time" value="${esc(timePart)}" aria-label="${MESSAGES.ariaLabels.eventStartTime}" />
        <select class="cal-popup-remind" aria-label="${MESSAGES.ariaLabels.eventReminder}">
          ${remindOptions
            .map(
              (m) =>
                `<option value="${m}"${m === evt.remind_minutes_before ? " selected" : ""}>${
                  m === 60 ? "1時間前" : `${m}分前`
                }</option>`,
            )
            .join("")}
        </select>
      </div>
      <label class="cal-popup-recurring" for="${recurringId}">
        <input id="${recurringId}" class="cal-popup-recurring-input" type="checkbox"${isWeekly ? " checked" : ""} />
        <span>毎週繰り返す</span>
      </label>
      <div class="cal-popup-actions">
        <button class="cal-popup-cancel">キャンセル</button>
        <button class="cal-popup-save">更新</button>
      </div>
    `;

    anchor.appendChild(popup);
    const input = popup.querySelector<HTMLInputElement>(".cal-popup-input")!;
    const saveBtn = popup.querySelector<HTMLElement>(".cal-popup-save")!;
    input.focus();
    input.select();

    popup.querySelector(".cal-popup-cancel")!.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.remove();
    });

    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const title = input.value.trim();
      if (!title) return;
      const dateVal = popup.querySelector<HTMLInputElement>(".cal-popup-date")!.value;
      const timeVal = popup.querySelector<HTMLInputElement>(".cal-popup-time")!.value;
      const remind = Number(popup.querySelector<HTMLSelectElement>(".cal-popup-remind")!.value);
      const isRecurring = popup.querySelector<HTMLInputElement>(
        ".cal-popup-recurring-input",
      )!.checked;
      if (!dateVal || !timeVal) {
        showToast({ title: MESSAGES.errors.eventDateTimeRequired, kind: "error" });
        return;
      }
      const scheduledAt = `${dateVal} ${timeVal}:00`;
      // M20: 編集時も過去日時には警告 toast を出す (繰り返しは対象外)
      if (!isRecurring && isPastDateTime(scheduledAt)) {
        showToast({
          title: MESSAGES.warns.eventPastUpdateTitle,
          body: MESSAGES.warns.eventPastBody,
          kind: "warn",
        });
      }
      // L5 連打防止: 二重送信で更新コマンドが連続発火するのを防ぐ
      (saveBtn as HTMLButtonElement).disabled = true;
      try {
        await updateCalendarEvent(
          evt.id,
          title,
          scheduledAt,
          isRecurring ? "weekly" : "none",
          remind,
        );
        popup.remove();
        await loadMonth();
        await refreshNotificationsStore();
      } catch (err) {
        showToast({
          title: MESSAGES.errors.eventUpdateFailed,
          body: errMessage(err),
          kind: "error",
        });
      } finally {
        if (popup.isConnected) (saveBtn as HTMLButtonElement).disabled = false;
      }
    });

    // L5: input keydown を popup の AbortController.signal に紐付ける (popup remove 時に自動 unregister)
    const inputKeyCtrl = new AbortController();
    input.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") saveBtn.click();
        if (e.key === "Escape") popup.remove();
      },
      { signal: inputKeyCtrl.signal },
    );

    popup.addEventListener("click", (e) => e.stopPropagation());

    registerDismiss(popup, inputKeyCtrl);
  }

  // 同日 +N 件を集約した「全予定リスト」ポップアップ (M19)。
  // 各行クリックで通常の showEventPopup (詳細/編集/削除) に切り替える。
  function showEventListPopup(events: CalendarEvent[], anchor: HTMLElement): void {
    closePopups();

    const popup = document.createElement("div");
    popup.className = "cal-popup cal-popup-list";
    const rows = events
      .map((evt) => {
        const time = evt.scheduled_at.split(/[ T]/)[1]?.slice(0, 5) || "";
        return `<button class="cal-popup-list-row" data-evt-id="${evt.id}">
          <span class="cal-popup-list-time">${esc(time)}</span>
          <span class="cal-popup-list-title">${esc(evt.title)}</span>
        </button>`;
      })
      .join("");
    popup.innerHTML = `
      <div class="cal-popup-title">この日の予定 (${events.length} 件)</div>
      <div class="cal-popup-list-body">${rows}</div>
      <div class="cal-popup-actions">
        <button class="cal-popup-cancel">閉じる</button>
      </div>
    `;

    anchor.appendChild(popup);

    popup.querySelectorAll<HTMLElement>(".cal-popup-list-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(row.dataset.evtId);
        const evt = events.find((x) => x.id === id);
        if (!evt) return;
        popup.remove();
        showEventPopup(evt, anchor);
      });
    });

    popup.querySelector(".cal-popup-cancel")!.addEventListener("click", (e) => {
      e.stopPropagation();
      popup.remove();
    });

    popup.addEventListener("click", (e) => e.stopPropagation());

    registerDismiss(popup);
  }

  // L5 Task 8: popup ごとに紐付ける補助 controller (input keydown 等) を束ねる配列。
  // closePopups 時にここに積まれた controller を全部 abort することで、
  // popup 解体後も生き残る listener (input.keydown 等) が新 popup に影響するのを防ぐ。
  // ※ 宣言は closePopups の前に置く (let の TDZ を避けるため、関数定義より前に出す)
  let popupAuxCtrls: AbortController[] = [];

  // 開いているポップアップを全て破棄する（新ポップアップを出す前に呼ぶ）。
  // 旧 popup に紐づく外側クリック dismiss も AbortController で一括解除する。
  function closePopups(): void {
    document.querySelectorAll(".cal-popup").forEach((p) => p.remove());
    if (popupDismissCtrl) {
      popupDismissCtrl.abort();
      popupDismissCtrl = null;
    }
    // L5 Task 8: 連動する各種補助 controller も一括 abort する
    if (popupAuxCtrls.length > 0) {
      for (const c of popupAuxCtrls) c.abort();
      popupAuxCtrls = [];
    }
  }

  // 指定 popup の外側クリック dismiss を登録する。
  // popup ごとに新規 AbortController を発行し、popupDismissCtrl に保持。次回 closePopups で
  // 旧 controller を abort することで、setTimeout(0) race による旧 dismiss の生き残りを潰す。
  // L5 Task 8: 既存 popupDismissCtrl があれば必ず abort してから新規発行する (多重 controller 抑止)。
  // L5 Task 10: 補助 controller (input keydown 等) を渡せるようにし、closePopups で連動 abort する。
  function registerDismiss(popup: HTMLElement, auxCtrl?: AbortController): void {
    // L5 Task 8: 旧 controller を必ず abort してから新規生成する
    if (popupDismissCtrl) {
      popupDismissCtrl.abort();
      popupDismissCtrl = null;
    }
    const ctrl = new AbortController();
    popupDismissCtrl = ctrl;
    if (auxCtrl) popupAuxCtrls.push(auxCtrl);
    setTimeout(() => {
      document.addEventListener(
        "click",
        (ev: MouseEvent) => {
          if (!popup.contains(ev.target as Node)) {
            popup.remove();
            ctrl.abort();
            // 補助 controller も連動 abort
            if (auxCtrl) auxCtrl.abort();
            if (popupDismissCtrl === ctrl) popupDismissCtrl = null;
          }
        },
        { signal: ctrl.signal },
      );
    }, 0);
  }

  subs.add(currentMonth.subscribe(() => void loadMonth()));
  void loadMonth();

  return container;
}

// 月を offset ぶんずらして currentMonth に反映する（12/1 月境界の年送りも処理）
function shiftMonth(offset: number): void {
  const { year, month } = currentMonth.get();
  let newMonth = month + offset;
  let newYear = year;
  if (newMonth > 12) {
    newMonth = 1;
    newYear++;
  } else if (newMonth < 1) {
    newMonth = 12;
    newYear--;
  }
  currentMonth.set({ year: newYear, month: newMonth });
}
