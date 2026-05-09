import { checkDueReminders } from "../api/commands";
import { settings } from "../state/store";
import type { ReminderEvent } from "../state/types";
import notifyChimeUrl from "../assets/sounds/notify-chime.mp3";

const voiceFiles = import.meta.glob("../assets/voices/*.wav", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

// 分数からボイスファイル名キーへのマッピング
const TIME_KEYS: Record<number, string> = {
  5: "5min",
  10: "10min",
  15: "15min",
  20: "20min",
  30: "30min",
  60: "1h",
};

let intervalId: number | undefined;

// リマインダーのポーリングを開始する
export function startReminderService(): void {
  intervalId = window.setInterval(pollReminders, 30_000);
}

// リマインダーのポーリングを停止する
export function stopReminderService(): void {
  if (intervalId === undefined) return;
  clearInterval(intervalId);
  intervalId = undefined;
}

// バックエンドに期限到来リマインダーを問い合わせる
async function pollReminders(): Promise<void> {
  try {
    const reminders = await checkDueReminders();
    for (const r of reminders) {
      await fireReminder(r);
    }
  } catch {
    // 次の周期でリトライ
  }
}

// リマインダーの通知音・トースト・音声を発火する
async function fireReminder(reminder: ReminderEvent): Promise<void> {
  const s = settings.get();

  if (s.reminder_sound_enabled) {
    playChime();
  }

  showReminderToast(reminder);

  if (s.voicevox_enabled && s.voice_character) {
    playVoiceFile(s.voice_character, reminder.minutes_until);
  }
}

// 通知チャイム音を再生する
function playChime(): void {
  const audio = new Audio(notifyChimeUrl);
  audio.volume = 0.7;
  audio.play().catch(() => {});
}

// 指定キャラ・分数のボイスファイルを再生する
export function playVoiceFile(character: string, minutes: number): void {
  const timeKey = TIME_KEYS[minutes];
  if (!timeKey) return;

  const url = voiceFiles[`../assets/voices/${character}_${timeKey}.wav`];
  if (!url) return;

  new Audio(url).play().catch(() => {});
}

// リマインダーのトースト通知を表示する
function showReminderToast(reminder: ReminderEvent): void {
  document.querySelector(".reminder-toast")?.remove();

  const toast = document.createElement("div");
  toast.className = "reminder-toast";
  toast.innerHTML = `
    <div class="reminder-toast-icon">&#x1F514;</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(reminder.title)}</div>
      <div class="reminder-toast-sub">${reminder.minutes_until}分前 ・ ${formatTime(reminder.scheduled_at)}</div>
    </div>
    <button class="reminder-toast-close">&times;</button>
  `;

  toast.querySelector(".reminder-toast-close")!
    .addEventListener("click", () => dismiss(toast));

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  setTimeout(() => dismiss(toast), 10_000);
}

// トーストをフェードアウトして削除する
function dismiss(toast: HTMLElement): void {
  toast.classList.remove("visible");
  setTimeout(() => toast.remove(), 400);
}

// ISO文字列を「H:MM」形式にフォーマットする
function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// HTML特殊文字をエスケープする
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
