import type { ScheduleNotification } from "../state/types";
import { dismissNotification } from "../api/commands";
import { escapeHtml as escHtml } from "../utils/html";
import { formatTime as formatNotifTime } from "../utils/datetime";

export function showStartupReminder(notifs: ScheduleNotification[]): void {
  if (notifs.length === 0) return;

  const el = document.createElement("div");
  el.className = "startup-reminder";

  const title = document.createElement("div");
  title.className = "startup-reminder-title";
  title.textContent = "Today's Schedule";

  const closeBtn = document.createElement("button");
  closeBtn.className = "reminder-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => {
    // × ボタン押下時は表示中の全件を恒久 dismiss
    // 週次予定は source_ref に発火日が含まれるため当該回のみ dismiss される
    for (const n of notifs.slice(0, 5)) {
      if (typeof n.source_ref === "string" && n.source_ref.length > 0) {
        dismissNotification(n.source_ref).catch(() => {});
      }
    }
    dismiss();
  });

  el.appendChild(title);
  el.appendChild(closeBtn);

  for (const notif of notifs.slice(0, 5)) {
    const item = document.createElement("div");
    item.className = "reminder-item";
    const time = formatNotifTime(notif.scheduled_at);
    item.innerHTML = `<span class="time">${time}</span>${escHtml(notif.title)}`;
    el.appendChild(item);
  }

  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));

  const autoClose = setTimeout(dismiss, 8000);

  // フェードアウト→ DOM 削除。autoClose は関数宣言巻き上げで参照可能（呼出時にバインド解決）。
  function dismiss(): void {
    clearTimeout(autoClose);
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 400);
  }
}
