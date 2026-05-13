// リマインダーポーリングサービス: 30 秒おきにバックエンドへ発火対象を問い合わせ、
// 該当があれば通知音 + トースト + (任意で) VOICEVOX ボイスを再生する。
// バックエンド (check_due_reminders) は取得と同時に reminded=1 へ更新するため、
// 同じイベントが二重発火することはない。
import { checkDueReminders } from "../api/commands";
import { settings } from "../state/store";
import type { ReminderEvent } from "../state/types";
import notifyChimeUrl from "../assets/sounds/notify-chime.mp3";

// 話者ボイスファイル群を Vite で事前読込し、URL 文字列の辞書として持つ
const voiceFiles = import.meta.glob("../assets/voices/*.wav", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

// 「N 分前」設定値 → ボイスファイル名サフィックスへのマッピング (例: 5 → "5min")
const TIME_KEYS: Record<number, string> = {
  5: "5min",
  10: "10min",
  15: "15min",
  20: "20min",
  30: "30min",
  60: "1h",
};

// 30 秒ポーリング用の interval ID（多重起動防止に undefined チェック）
let intervalId: number | undefined;

// ポーリングを開始する。既に起動済みなら no-op（多重起動防止）。
export function startReminderService(): void {
  if (intervalId !== undefined) return;
  intervalId = window.setInterval(pollReminders, 30_000);
}

// ポーリングを停止する。停止中なら no-op。
export function stopReminderService(): void {
  if (intervalId === undefined) return;
  clearInterval(intervalId);
  intervalId = undefined;
}

// バックエンドに発火対象を問い合わせて 1 件ずつ通知発火する。例外は次の周期に任せる。
async function pollReminders(): Promise<void> {
  try {
    const reminders = await checkDueReminders();
    for (const r of reminders) {
      await fireReminder(r);
    }
  } catch {
    // 次の周期でリトライ（一時的な DB ロック等を想定）
  }
}

// 設定に応じて通知音・トースト・読み上げを発火する。トーストは必ず出す。
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

// 通知チャイム (notify-chime.mp3) を 0.7 音量で再生する
function playChime(): void {
  const audio = new Audio(notifyChimeUrl);
  audio.volume = 0.7;
  audio.play().catch(() => {});
}

// "<character>_<timeKey>.wav" を解決して再生する。
// 該当ファイルが無い (TIME_KEYS にないか、ボイス未収録) 場合は何もしない。
// SettingsPage のテスト再生ボタンからも呼ばれるため export している。
export function playVoiceFile(character: string, minutes: number): void {
  const timeKey = TIME_KEYS[minutes];
  if (!timeKey) return;

  const url = voiceFiles[`../assets/voices/${character}_${timeKey}.wav`];
  if (!url) return;

  new Audio(url).play().catch(() => {});
}

// 画面右下に滑り込むリマインダートースト。同時に複数出さないため既存トーストを先に消す。
// 10 秒で自動消滅、× ボタンで手動消滅。
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

// トーストをフェードアウト (400ms) → DOM から取り除く
function dismiss(toast: HTMLElement): void {
  toast.classList.remove("visible");
  setTimeout(() => toast.remove(), 400);
}

// ISO/SQL 日時文字列から "H:MM" を抽出する。失敗時は空文字。
function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, "0")}`;
  } catch {
    return "";
  }
}

// innerHTML に流す前の HTML 特殊文字エスケープ
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
