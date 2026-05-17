// 汎用トースト UI ヘルパー。リマインダー用トースト (`reminder.ts::showReminderToast`) の
// CSS (`.reminder-toast`/`-icon`/`-body`/`-title`/`-sub`/`-close`) を共有しつつ、
// アイコンと表示時間を切替えて成功/失敗/情報通知に使う。
// 同種トーストの多重表示を避けるため、`{kind}-toast` 系の既存要素は先に取り除く。

import { escapeHtml } from "./html";
import { MESSAGES } from "./messages";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastOptions {
  title: string;
  body?: string;
  kind?: ToastKind;
  /** ミリ秒。既定は kind 別 (success/info=3000, warn/error=5000)。0 で自動消滅無効。 */
  durationMs?: number;
  /**
   * トースト本体クリック時のハンドラ。指定時はカーソルを pointer に切り替え、
   * クリックで dismiss してからコールバックを実行する (× ボタン押下時は遷移しない)。
   */
  onClick?: () => void;
}

const ICONS: Record<ToastKind, string> = {
  success: "&#x2714;",
  error: "&#x26A0;",
  warn: "&#x26A0;",
  info: "&#x2139;",
};

// Loop 4 UX-04: warn/error は同一カテゴリ (注意喚起) として 5 秒で統一する。
// 旧 error=6000 / warn=5000 のズレを解消し「警告系は 5 秒」の単一ルールにした。
const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 3000,
  warn: 5000,
  error: 5000,
};

// 通知系トーストを画面右上に表示する。kind と本文は呼び出し側で指定する。
// 既存の `.app-toast` は dismiss してから新規追加 (1 件だけ表示する単純方針)。
export function showToast(opts: ToastOptions): void {
  document.querySelector(".app-toast")?.remove();

  const kind: ToastKind = opts.kind ?? "info";
  const toast = document.createElement("div");
  // `reminder-toast` クラスを共有して既存 CSS を流用し、`app-toast` で型別を識別する
  toast.className = `reminder-toast app-toast app-toast-${kind}`;
  // a11y: error は role="alert" で即時通知、それ以外は role="status"。
  // warn/error は assertive (割り込み)、success/info は polite。aria-atomic でメッセージ全体を読み上げる。
  toast.setAttribute("role", kind === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", kind === "warn" || kind === "error" ? "assertive" : "polite");
  toast.setAttribute("aria-atomic", "true");
  toast.innerHTML = `
    <div class="reminder-toast-icon">${ICONS[kind]}</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(opts.title)}</div>
      ${opts.body ? `<div class="reminder-toast-sub">${escapeHtml(opts.body)}</div>` : ""}
    </div>
    <button class="reminder-toast-close" aria-label="${MESSAGES.ui.actionClose}">&times;</button>
  `;

  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  const dismiss = () => {
    if (autoTimer !== null) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  };

  toast.querySelector(".reminder-toast-close")?.addEventListener("click", (e) => {
    // × ボタンは閉じるだけで onClick を発火させない
    e.stopPropagation();
    dismiss();
  });

  if (opts.onClick) {
    const handler = opts.onClick;
    toast.style.cursor = "pointer";
    toast.addEventListener("click", () => {
      dismiss();
      handler();
    });
  }

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  const duration = opts.durationMs ?? DEFAULT_DURATION[kind];
  if (duration > 0) {
    autoTimer = setTimeout(dismiss, duration);
  }
}
