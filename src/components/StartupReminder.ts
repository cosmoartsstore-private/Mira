import type { ScheduleNotification } from "../state/types";

// 起動時に右下に滑り込むトースト形式の予定リマインダーを表示する。
// 最大5件、8秒で自動消滅。app.ts から 1200ms 遅延で呼ばれて他の起動演出と被らせない。
export function showStartupReminder(notifications: ScheduleNotification[]): void {
  if (notifications.length === 0) return;

  const el = document.createElement("div");
  el.className = "startup-reminder";

  const title = document.createElement("div");
  title.className = "startup-reminder-title";
  title.textContent = "Today's Schedule";

  const closeBtn = document.createElement("button");
  closeBtn.className = "reminder-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", dismiss);

  el.appendChild(title);
  el.appendChild(closeBtn);

  for (const notif of notifications.slice(0, 5)) {
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

// ISO/SQL 日時文字列から "H:MM" を抽出する
function formatNotifTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// innerHTML に流す前の HTML 特殊文字エスケープ
function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
