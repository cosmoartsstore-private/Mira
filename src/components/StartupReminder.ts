import type { ScheduleNotification } from "../state/types";

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

  function dismiss(): void {
    clearTimeout(autoClose);
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 400);
  }
}

function formatNotifTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
