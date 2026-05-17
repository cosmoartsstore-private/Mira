import type { ScheduleNotification } from "../state/types";
import { dismissNotification } from "../api/commands";
import { escapeHtml as esc, errMessage } from "../utils/html";
import { formatTime as formatNotifTime } from "../utils/datetime";
import { showToast } from "../utils/toast";
import { MESSAGES } from "../utils/messages";

export function showStartupReminder(notifs: ScheduleNotification[]): void {
  if (notifs.length === 0) return;

  const el = document.createElement("div");
  el.className = "startup-reminder";

  const title = document.createElement("div");
  title.className = "startup-reminder-title";
  title.textContent = MESSAGES.ui.startupReminderTitle;

  const closeBtn = document.createElement("button");
  closeBtn.className = "reminder-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", () => {
    // × ボタン押下時は表示中の全件を恒久 dismiss
    // 週次予定は source_ref に発火日が含まれるため当該回のみ dismiss される
    // R2-C-7/H-5: dismiss API 失敗時は無音再採用を避けるためユーザーに警告を出す
    for (const n of notifs.slice(0, 5)) {
      if (typeof n.source_ref === "string" && n.source_ref.length > 0) {
        dismissNotification(n.source_ref).catch((e: unknown) => {
          showToast({
            kind: "error",
            title: MESSAGES.errors.dismissNotificationFailedTitle,
            body: MESSAGES.errors.dismissNotificationFailedBody(n.title, errMessage(e)),
          });
        });
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
    item.innerHTML = `<span class="time">${time}</span>${esc(notif.title)}`;
    el.appendChild(item);
  }

  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));

  const autoClose = setTimeout(dismiss, 8000);
  // L5 Task 6: フェードアウト後の DOM 削除タイマーも保持する。
  //   400ms 中にコンポーネントが unmount されたり再度 dismiss が呼ばれた場合、
  //   旧タイマーが生き残って既に消えた要素に .remove() を空打ちしたり、
  //   後から差し替わった同名要素 (再起動 reminder の再表示) を誤削除し得るため、
  //   autoClose と同じパターンで明示的に保持し、再 dismiss 時に clear する。
  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  // フェードアウト→ DOM 削除。autoClose は関数宣言巻き上げで参照可能（呼出時にバインド解決）。
  function dismiss(): void {
    clearTimeout(autoClose);
    // 多重 dismiss 時に旧 removeTimer をキャンセル (空打ち防止)
    if (removeTimer !== null) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
    el.classList.remove("visible");
    removeTimer = setTimeout(() => {
      el.remove();
      removeTimer = null;
    }, 400);
  }
}
