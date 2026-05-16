// リマインダーポーリングサービス: 30 秒おきにバックエンドへ発火対象を問い合わせ、
// 該当があれば通知音 + トースト + (任意で) VOICEVOX ボイスを再生する。
// バックエンド (check_due_reminders) は取得と同時に reminded=1 へ更新するため、
// 同じイベントが二重発火することはない。
import { checkDueReminders } from "../api/commands";
import { settings } from "../state/store";
import type { ReminderEvent } from "../state/types";
import notifyChimeUrl from "../assets/sounds/notify-chime.mp3";
import { escapeHtml } from "../utils/html";
import { formatTime } from "../utils/datetime";

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

const BASE_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 5 * 60_000; // 5min まで指数で広げる

let intervalId: number | undefined;
let currentIntervalMs = BASE_INTERVAL_MS;
// 連続失敗カウンタ。指数バックオフのために保持する
let consecutiveFailures = 0;

// リマインダーのポーリングを開始する (多重登録防止)
export function startReminderService(): void {
  if (intervalId !== undefined) return;
  consecutiveFailures = 0;
  currentIntervalMs = BASE_INTERVAL_MS;
  scheduleNext();
}

// ポーリングを停止する。停止中なら no-op。
export function stopReminderService(): void {
  if (intervalId === undefined) return;
  clearTimeout(intervalId);
  intervalId = undefined;
}

// 次回のポーリングをスケジュールする (指数バックオフ対応)
function scheduleNext(): void {
  intervalId = window.setTimeout(async () => {
    await pollReminders();
    if (intervalId === undefined) return; // 途中で stop されたら何もしない
    scheduleNext();
  }, currentIntervalMs);
}

// バックエンドに期限到来リマインダーを問い合わせる
//
// R2-M-15: 成功時は consecutiveFailures をリセットしバックオフを解除する。
// 失敗時は指数バックオフで間隔を広げつつ永久停止はしない (一時的な DB ロック等から
// 自動復帰させるため)。
async function pollReminders(): Promise<void> {
  try {
    const reminders = await checkDueReminders();
    consecutiveFailures = 0;
    currentIntervalMs = BASE_INTERVAL_MS;
    for (const r of reminders) {
      await fireReminder(r);
    }
  } catch (e) {
    consecutiveFailures += 1;
    // 指数バックオフ (30s → 60s → 120s → 240s → 5min cap)
    currentIntervalMs = Math.min(BASE_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFailures, 5) - 1), MAX_INTERVAL_MS);
    console.warn(
      `[reminder] checkDueReminders 失敗 (${consecutiveFailures}回連続) 次回 ${currentIntervalMs}ms 後`,
      e,
    );
  }
}

// 設定に応じて通知音・トースト・読み上げを発火する。トーストは必ず出す。
async function fireReminder(reminder: ReminderEvent): Promise<void> {
  const s = settings.get();

  if (s.reminder_sound_enabled) {
    playChime();
  }

  showReminderToast(reminder);

  // 期限切れは音声スキップ (TIME_KEYS に minutes_until がない場合も)
  if (s.voicevox_enabled && s.voice_character && reminder.minutes_until >= 0) {
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

  // minutes_until が負の場合は「N 分過ぎました」表示
  const mu = reminder.minutes_until;
  const subText = mu >= 0
    ? `${mu}分前 ・ ${formatTime(reminder.scheduled_at)}`
    : `${Math.abs(mu)}分過ぎました ・ ${formatTime(reminder.scheduled_at)}`;

  const toast = document.createElement("div");
  toast.className = "reminder-toast";
  toast.innerHTML = `
    <div class="reminder-toast-icon">&#x1F514;</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(reminder.title)}</div>
      <div class="reminder-toast-sub">${subText}</div>
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

