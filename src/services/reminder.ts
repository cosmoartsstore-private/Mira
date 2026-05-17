// リマインダーポーリングサービス: 30 秒おきにバックエンドへ発火対象を問い合わせ、
// 該当があれば通知音 + トースト + (任意で) VOICEVOX ボイスを再生する。
// バックエンド (check_due_reminders) は取得と同時に reminded=1 へ更新するため、
// 同じイベントが二重発火することはない。
import { checkDueReminders } from "../api/commands";
import { settings, activeTab, focusedDate } from "../state/store";
import type { ReminderEvent } from "../state/types";
import notifyChimeUrl from "../assets/sounds/notify-chime.mp3";
import { escapeHtml } from "../utils/html";
import { formatTime } from "../utils/datetime";
import { showToast } from "../utils/toast";
import { MESSAGES } from "../utils/messages";

// 話者ボイスファイル群は遅延読込にする (初期 bundle に含めない)。
// `eager: false` により URL を解決する関数の辞書になり、再生時に動的 import で取得する。
// VOICEVOX 利用ユーザーのみが必要時に取得することで初期 JS+wav の同梱を回避し、
// dist 初期 bundle サイズを大幅に減らす (約 8.5MB → 約 3.4MB)。
const voiceFiles = import.meta.glob<string>("../assets/voices/*.wav", {
  query: "?url",
  import: "default",
});

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
// ウィンドウ最小化/別タブ滞在中は省電力のためポーリング間隔を 5 分に伸ばす
const HIDDEN_INTERVAL_MS = 5 * 60_000;
// 連続失敗が何回続いたらユーザーに警告 toast を出すかの閾値
const FAILURE_WARN_THRESHOLD = 3;
// L4 R4-Err-6: 連続失敗で自動停止に踏み切る閾値。
//   バックオフが MAX_INTERVAL_MS (5min) に張り付くまで 5 回 + その後 10 回連続失敗 (約 50 分)
//   で「自然回復は見込めない」と判断し、`stopReminderService()` を呼んでポーリングを止める。
//   このタイミングでユーザーに「再起動を促す」永続トーストを出す (durationMs=0 で自動消滅無し)。
const PERMANENT_FAILURE_THRESHOLD = 15;
// reminder toast 同士の縦間隔 (CSS 側で base offset を持つため、ここでは差分のみ)
const REMINDER_TOAST_GAP_PX = 96;

let intervalId: number | undefined;
let currentIntervalMs = BASE_INTERVAL_MS;
// 連続失敗カウンタ。指数バックオフのために保持する
let consecutiveFailures = 0;
// 失敗通知トーストを 1 度だけ出すための再表示防止フラグ
let failureWarnShown = false;
// visibilitychange ハンドラを stop 時に解除できるよう保持する
let visibilityHandler: (() => void) | undefined;
// L5 Mem: HTMLAudioElement を毎回 new せず使い回すためのキャッシュ。
// 再生中に新規発火が来たら現在の再生を停止 (pause + currentTime=0) してから再利用する。
// これによりサンプル数だけインスタンスが GC 待ちになるリークを防ぐ。
let chimeAudio: HTMLAudioElement | undefined;
let currentVoiceAudio: HTMLAudioElement | undefined;

// リマインダーのポーリングを開始する (多重登録防止)。
// 起動時に内部 state (失敗カウンタ・警告フラグ・間隔) を明示初期化する。
export function startReminderService(): void {
  if (intervalId !== undefined) return;
  consecutiveFailures = 0;
  currentIntervalMs = currentBaseIntervalMs();
  failureWarnShown = false;

  // R3-perf: visibility に応じて poll 間隔を切り替える。
  // hidden → 5 分に伸長, visible 復帰 → 30 秒へ戻し即座に 1 回 poll する。
  visibilityHandler = () => {
    const nextBase = currentBaseIntervalMs();
    currentIntervalMs = nextBase;
    if (!document.hidden) {
      // 即時 poll: 既存タイマーをキャンセルして新規に立て直す
      if (intervalId !== undefined) {
        clearTimeout(intervalId);
        intervalId = undefined;
      }
      void pollReminders().finally(() => {
        // pollReminders 内でバックオフ調整される可能性があるため再評価しない (現値を尊重)
        scheduleNext();
      });
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  scheduleNext();
}

// テスト/将来再起動用に明示停止 API を提供する (多重起動防止と対になる)。
// app.ts は単一起動だが、HMR や設定再適用シナリオでの dispose を保証する。
export function stopReminderService(): void {
  if (intervalId !== undefined) {
    clearTimeout(intervalId);
    intervalId = undefined;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = undefined;
  }
  consecutiveFailures = 0;
  currentIntervalMs = BASE_INTERVAL_MS;
  failureWarnShown = false;
}

// 現在の可視状態に応じたベース間隔を返す (バックオフ前の基準値)
function currentBaseIntervalMs(): number {
  return document.hidden ? HIDDEN_INTERVAL_MS : BASE_INTERVAL_MS;
}

// 次回のポーリングをスケジュールする (指数バックオフ対応)
function scheduleNext(): void {
  intervalId = window.setTimeout(() => {
    void pollReminders().finally(() => {
      scheduleNext();
    });
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
    // 成功時のリセットは可視状態に応じたベース値 (hidden=5min / visible=30s) に戻す
    currentIntervalMs = currentBaseIntervalMs();
    // R2-H-10: 回復したら警告トーストを片付け、次回失敗時に再度通知できるようにする
    if (failureWarnShown) {
      document.querySelector(".reminder-failure-toast")?.remove();
      failureWarnShown = false;
    }
    for (const r of reminders) {
      fireReminder(r);
    }
  } catch (e) {
    consecutiveFailures += 1;
    // 指数バックオフ (可視時 30s → 60s → 120s → 240s → 5min cap, 不可視時はすでに 5min なので
    // 直ちに上限に張り付く)
    currentIntervalMs = Math.min(
      currentBaseIntervalMs() * Math.pow(2, Math.min(consecutiveFailures, 5) - 1),
      MAX_INTERVAL_MS,
    );
    // L5 Log: 一時的なリトライ可能エラー (DB ロック等で次回 poll でも復帰可) は DEV のみ可視化。
    // production では FAILURE_WARN_THRESHOLD 超え時に toast で集約表示する方針に統一する。
    if (import.meta.env.DEV) {
      console.warn(
        `[reminder] checkDueReminders 失敗 (${consecutiveFailures}回連続) 次回 ${currentIntervalMs}ms 後`,
        e,
      );
    }
    // R2-H-10: 連続失敗が閾値を超えたら一度だけユーザーに伝える (回復時にフラグを下ろす)
    if (consecutiveFailures >= FAILURE_WARN_THRESHOLD && !failureWarnShown) {
      failureWarnShown = true;
      // Loop 4 UX-03: エラー文体を「[操作名]に失敗しました」形式に統一。
      // 旧 "失敗しています" は他の toast (全て "失敗しました" 過去形) と揺れていた。
      showToast({
        kind: "warn",
        title: MESSAGES.warns.reminderFetchFailedTitle,
        body: MESSAGES.warns.reminderFetchFailedBody,
        durationMs: 0,
      });
      // 失敗トーストを CSS セレクタで掴めるよう識別用クラスを付与
      const last = document.querySelector(".app-toast");
      last?.classList.add("reminder-failure-toast");
    }
    // L4 R4-Err-6: 永続失敗 (約 50 分以上回復しない) と判定したらポーリングを自動停止し、
    //   再起動を促す永続トーストへ差し替える。`stopReminderService()` 内で
    //   `consecutiveFailures` と `failureWarnShown` がリセットされるため、
    //   この判定ブロックは閾値到達時に 1 回だけ通過する。
    if (consecutiveFailures >= PERMANENT_FAILURE_THRESHOLD) {
      console.error(
        `[reminder] checkDueReminders が ${consecutiveFailures} 回連続失敗。ポーリングを停止します。`,
      );
      stopReminderService();
      // 既存の警告トースト (.reminder-failure-toast) は片付け、より強い停止通知を出し直す
      document.querySelector(".reminder-failure-toast")?.remove();
      showToast({
        kind: "warn",
        title: MESSAGES.warns.reminderStoppedTitle,
        body: MESSAGES.warns.reminderStoppedBody,
        durationMs: 0,
      });
    }
  }
}

// 設定に応じて通知音・トースト・読み上げを発火する。トーストは必ず出す。
// (現状は同期処理のみだが、将来 await が必要になっても呼出側の `await fireReminder(...)` で
// 自然に切替えられる契約として戻り値型は `void` のままにする)
function fireReminder(reminder: ReminderEvent): void {
  const s = settings.get();

  if (s.reminder_sound_enabled) {
    playChime();
  }

  showReminderToast(reminder);

  // 期限切れは音声スキップ (TIME_KEYS に minutes_until がない場合も)
  if (s.voicevox_enabled && s.voice_character && reminder.minutes_until >= 0) {
    // playVoiceFile は wav の動的 import を含むため Promise を返すが、
    // fireReminder の呼出契約は void のまま。失敗時は内部で握りつぶされる。
    void playVoiceFile(s.voice_character, reminder.minutes_until);
  }
}

// 通知チャイム (notify-chime.mp3) を 0.7 音量で再生する。
// L5 Mem: HTMLAudioElement を毎回 new せず chimeAudio に 1 個だけ保持して再利用する。
// 直前のチャイムがまだ鳴っていた場合は pause + currentTime=0 で巻き戻してから再生し直す。
function playChime(): void {
  if (!chimeAudio) {
    chimeAudio = new Audio(notifyChimeUrl);
    chimeAudio.volume = 0.7;
  }
  try {
    chimeAudio.pause();
    chimeAudio.currentTime = 0;
  } catch {
    // pause/currentTime 操作は要素状態によっては throw する (loading 直後 等) ため握りつぶす
  }
  chimeAudio.play().catch(() => {});
}

// "<character>_<timeKey>.wav" を解決して再生する。
// 該当ファイルが無い (TIME_KEYS にないか、ボイス未収録) 場合は無音 fallback (何もしない)。
// wav は遅延 import なので初回再生時にのみ chunk をロードする。
// SettingsPage のテスト再生ボタンからも呼ばれるため export している。
export async function playVoiceFile(character: string, minutes: number): Promise<void> {
  const timeKey = TIME_KEYS[minutes];
  if (!timeKey) return;

  // import.meta.glob の型は「マッチした全キーが non-undefined」を返すが、
  // 未収録 character やタイポでは実行時に key が存在しない。
  // try で動的 import 失敗ごと無音 fallback に倒すことで存在チェックを兼ねる。
  const key = `../assets/voices/${character}_${timeKey}.wav`;
  try {
    const loader = voiceFiles[key];
    const url = await loader();
    // L5 Mem: ボイス用 HTMLAudioElement も 1 個だけ保持して再利用する。
    // 同じ url なら src 再設定を回避し、別 url (キャラ変更や別タイミング) ならその場で差し替える。
    // 直前のボイス再生中なら停止 + 巻き戻ししてから次を流す。
    if (!currentVoiceAudio) {
      currentVoiceAudio = new Audio(url);
    } else {
      try {
        currentVoiceAudio.pause();
        currentVoiceAudio.currentTime = 0;
      } catch {
        // pause/currentTime 操作は要素状態によっては throw する場合があるため握りつぶす
      }
      if (currentVoiceAudio.src !== url) {
        currentVoiceAudio.src = url;
      }
    }
    await currentVoiceAudio.play();
  } catch (e) {
    // ファイル不存在 / 再生失敗 / autoplay 抑止 等は無音 fallback (現状仕様維持)
    // dev 環境のみ可視化: 収録漏れや autoplay 抑止の原因切り分けを支援する
    if (import.meta.env.DEV) {
      console.warn(`[reminder] playVoiceFile 失敗: ${key}`, e);
    }
  }
}

// 画面右下に滑り込むリマインダートースト。
// R2-H-9: 複数リマインダーが同時発火した場合、既存を消さず縦方向にスタックさせる。
// 10 秒で自動消滅、× ボタンで手動消滅。本体クリックで該当日付の HomePage に遷移する。
function showReminderToast(reminder: ReminderEvent): void {
  // minutes_until が負の場合は「N 分過ぎました」表示
  const mu = reminder.minutes_until;
  const subText =
    mu >= 0
      ? `${mu}分前 ・ ${formatTime(reminder.scheduled_at)}`
      : `${Math.abs(mu)}分過ぎました ・ ${formatTime(reminder.scheduled_at)}`;

  const toast = document.createElement("div");
  toast.className = "reminder-toast reminder-toast-stacked";
  // a11y: リマインダー通知は時刻に依存する重要情報なので alert/assertive で即時読み上げ。
  // aria-atomic でタイトルと時刻 (sub) をまとめて 1 メッセージとして扱う。
  // lang=ja を明示してスクリーンリーダーに日本語音声合成を選択させる (本文は日本語固定)。
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "assertive");
  toast.setAttribute("aria-atomic", "true");
  toast.setAttribute("lang", "ja");
  // 既存の reminder toast の個数分だけ縦にオフセットする (CSS の固定 bottom 値に加算)
  const existingCount = document.querySelectorAll(".reminder-toast-stacked").length;
  toast.style.transform = `translateY(-${existingCount * REMINDER_TOAST_GAP_PX}px)`;
  toast.style.cursor = "pointer";
  toast.innerHTML = `
    <div class="reminder-toast-icon" aria-hidden="true">&#x1F514;</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(reminder.title)}</div>
      <div class="reminder-toast-sub">${subText}</div>
    </div>
    <button class="reminder-toast-close" aria-label="${MESSAGES.ui.closeReminder}">&times;</button>
  `;

  // R3-perf: 自動 dismiss タイマーを保持し、手動 dismiss 時にキャンセルする。
  // 旧実装では × ボタンや本体クリックで閉じた後も 10 秒タイマーが残り、
  // 既に DOM から消えた要素を対象に dismiss() が再度走るリークがあった。
  //
  // L5 Task 9: close button と autoTimer (10s) が同フレーム内で同時発火するレース対策。
  //   既に DOM から外れている (= 別経路で dismiss 済み) なら何もしない早期 return を追加。
  //   これにより、続く querySelector(".reminder-toast-close") など toast 周辺の DOM 参照が
  //   detach 中の要素を掴んで null 例外になるのを防ぐ。
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  const dismissOnce = () => {
    if (!toast.parentNode) {
      if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
      return;
    }
    if (autoTimer !== null) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    dismiss(toast);
  };

  toast.querySelector(".reminder-toast-close")!.addEventListener("click", (e) => {
    // × ボタンは閉じるだけ。本体クリックハンドラ (遷移) は発火させない
    e.stopPropagation();
    dismissOnce();
  });

  // R2-M-17: 本体クリックで該当日付の HomePage を開く
  toast.addEventListener("click", () => {
    // "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DDTHH:MM:SS" 共通で先頭 10 文字が日付部
    const date = reminder.scheduled_at.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      focusedDate.set(date);
    }
    activeTab.set("home");
    dismissOnce();
  });

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  autoTimer = setTimeout(dismissOnce, 10_000);
}

// トーストをフェードアウト (400ms) → DOM から取り除く
function dismiss(toast: HTMLElement): void {
  toast.classList.remove("visible");
  setTimeout(() => toast.remove(), 400);
}
