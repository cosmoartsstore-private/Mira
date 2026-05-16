import { getMonthData, addEvent, removeEvent, refreshNotifications } from "../../api/commands";
import {
  currentMonth,
  activeTab,
  currentWeekStart,
  focusedDate,
  notifications,
  Subscriptions,
} from "../../state/store";
import { getJapaneseHolidays } from "../../utils/holidays";
import { confirmDialog } from "../../utils/confirmDialog";
import { showToast } from "../../utils/toast";
import { escapeHtml as esc } from "../../utils/html";
import type { CalendarEvent } from "../../state/types";

// 月別カレンダー。月内のアクティブ日 (訪問あり) と祝日・予定を表示する。
// グリッドの曜日順は **月曜始まり** (Mon..Sun)。一方データ層 (HomePage) は **日曜始まり** 週で動く。
// アクティブ日クリック時は d - getDay() で日曜を求めて currentWeekStart に渡し、HomePage の世界観に合わせる。
export function CalendarPage(subs: Subscriptions): HTMLElement {
  const container = document.createElement("div");
  container.className = "calendar-page";

  const pageHead = document.createElement("div");
  pageHead.className = "page-head";
  pageHead.innerHTML = `<h1>Calendar</h1><span class="sub">過去の記録を辿る</span>`;

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

  // 上部の年・月ラベル ("2026 Apr" のような表示) を currentMonth の値で更新する
  function updateLabel(): void {
    const { year, month } = currentMonth.get();
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    monthLabel.innerHTML = `<span class="year">${year}</span>${monthNames[month - 1]}`;
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
    const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const wd of weekdays) {
      const head = document.createElement("div");
      head.className = "cal-head";
      if (wd === "Sat") head.classList.add("saturday");
      if (wd === "Sun") head.classList.add("sunday");
      head.textContent = wd;
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

      for (const evt of dayEvents) {
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

      // セルクリックの分岐:
      //  - アクティブ日 (訪問あり) かつ予定なし → HomePage のフォーカス表示へ飛ぶ
      //  - それ以外 (空き日 / 既存予定あり) → 予定追加フォームを開く
      // HomePage は日曜始まり週で動くため、ここで d - getDay() を引いて日曜の日付を求める。
      cell.addEventListener("click", () => {
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (isActive && dayEvents.length === 0) {
          const dayOfWeek = new Date(year, month - 1, d).getDay();
          const weekStart = new Date(year, month - 1, d - dayOfWeek);
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

    const popup = document.createElement("div");
    popup.className = "cal-popup";

    popup.innerHTML = `
      <div class="cal-popup-title">予定を追加</div>
      <input class="cal-popup-input" type="text" placeholder="予定のタイトル" />
      <div class="cal-popup-row">
        <input class="cal-popup-time" type="time" value="12:00" />
        <select class="cal-popup-remind">
          <option value="5">5分前</option>
          <option value="10" selected>10分前</option>
          <option value="15">15分前</option>
          <option value="20">20分前</option>
          <option value="30">30分前</option>
          <option value="60">1時間前</option>
        </select>
      </div>
      <label class="cal-popup-recurring">
        <input class="cal-popup-recurring-input" type="checkbox" />
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
      try {
        await addEvent(title, scheduledAt, remind, isRecurring, isRecurring ? "weekly" : null);
        popup.remove();
        await loadMonth();
        await refreshNotificationsStore();
      } catch (err) {
        showToast({ title: "予定の追加に失敗しました", body: String(err), kind: "error" });
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveBtn.click();
      if (e.key === "Escape") popup.remove();
    });

    popup.addEventListener("click", (e) => e.stopPropagation());

    setTimeout(() => {
      const dismiss = (ev: MouseEvent) => {
        if (!popup.contains(ev.target as Node)) {
          popup.remove();
          document.removeEventListener("click", dismiss);
        }
      };
      document.addEventListener("click", dismiss);
    }, 0);
  }

  // 既存予定タグのクリックで詳細・削除ボタン付きポップアップを開く
  function showEventPopup(evt: CalendarEvent, anchor: HTMLElement): void {
    closePopups();

    const time = evt.scheduled_at.split(/[ T]/)[1]?.slice(0, 5) || "";
    const popup = document.createElement("div");
    popup.className = "cal-popup";
    popup.innerHTML = `
      <div class="cal-popup-title">${esc(evt.title)}</div>
      <div class="cal-popup-detail">${time} ・ ${evt.remind_minutes_before}分前通知</div>
      <div class="cal-popup-actions">
        <button class="cal-popup-delete">削除</button>
      </div>
    `;

    anchor.appendChild(popup);

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
        showToast({ title: "予定の削除に失敗しました", body: String(err), kind: "error" });
      }
    });

    popup.addEventListener("click", (e) => e.stopPropagation());

    setTimeout(() => {
      const dismiss = (ev: MouseEvent) => {
        if (!popup.contains(ev.target as Node)) {
          popup.remove();
          document.removeEventListener("click", dismiss);
        }
      };
      document.addEventListener("click", dismiss);
    }, 0);
  }

  // 開いているポップアップを全て破棄する（新ポップアップを出す前に呼ぶ）
  function closePopups(): void {
    document.querySelectorAll(".cal-popup").forEach((p) => p.remove());
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
