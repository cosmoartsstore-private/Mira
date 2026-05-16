// 汎用トースト UI ヘルパー。リマインダー用トースト (`reminder.ts::showReminderToast`) の
// CSS (`.reminder-toast`/`-icon`/`-body`/`-title`/`-sub`/`-close`) を共有しつつ、
// アイコンと表示時間を切替えて成功/失敗/情報通知に使う。
// 同種トーストの多重表示を避けるため、`{kind}-toast` 系の既存要素は先に取り除く。

import { escapeHtml } from "./html";

export type ToastKind = "success" | "error" | "warn" | "info";

export interface ToastOptions {
  title: string;
  body?: string;
  kind?: ToastKind;
  /** ミリ秒。既定は kind 別 (success/info=3000, warn=5000, error=6000)。0 で自動消滅無効。 */
  durationMs?: number;
}

const ICONS: Record<ToastKind, string> = {
  success: "&#x2714;",
  error: "&#x26A0;",
  warn: "&#x26A0;",
  info: "&#x2139;",
};

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 3000,
  info: 3000,
  warn: 5000,
  error: 6000,
};

// 通知系トーストを画面右上に表示する。kind と本文は呼び出し側で指定する。
// 既存の `.app-toast` は dismiss してから新規追加 (1 件だけ表示する単純方針)。
export function showToast(opts: ToastOptions): void {
  document.querySelector(".app-toast")?.remove();

  const kind: ToastKind = opts.kind ?? "info";
  const toast = document.createElement("div");
  // `reminder-toast` クラスを共有して既存 CSS を流用し、`app-toast` で型別を識別する
  toast.className = `reminder-toast app-toast app-toast-${kind}`;
  toast.innerHTML = `
    <div class="reminder-toast-icon">${ICONS[kind]}</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(opts.title)}</div>
      ${opts.body ? `<div class="reminder-toast-sub">${escapeHtml(opts.body)}</div>` : ""}
    </div>
    <button class="reminder-toast-close" aria-label="閉じる">&times;</button>
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

  toast.querySelector(".reminder-toast-close")?.addEventListener("click", dismiss);

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  const duration = opts.durationMs ?? DEFAULT_DURATION[kind];
  if (duration > 0) {
    autoTimer = setTimeout(dismiss, duration);
  }
}
