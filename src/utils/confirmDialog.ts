// 標準 `window.confirm` の代替。Tauri WebView2 でブロッキング系 dialog API が
// 抑制されることがあるため、自前のオーバーレイ + ボタンで Promise<boolean> を返す。
// Esc: キャンセル / Enter: OK / オーバーレイクリック: キャンセル。
// Loop 4 UX-01/02: モーダル閉じ方 (Esc + overlay クリック) を snapshot-modal / lightbox と統一。
// OK/Cancel 必須選択のため × ボタンは省略 (overlay クリックが cancel 扱い)。
// ボタン左右順は secondary 左 → primary 右に統一し、OK は .confirm-ok クラスで primary 色を当てる。
import { trapFocus, inertBackground } from "./focusTrap";
import { MESSAGES } from "./messages";

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "mira-confirm-overlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", MESSAGES.ui.confirmDialogLabel);
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.className = "mira-confirm-card";
    card.style.cssText =
      "background:#fff;color:#222;padding:20px 24px;border-radius:8px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.25);font-family:inherit;";

    const msg = document.createElement("div");
    msg.className = "mira-confirm-msg";
    msg.style.cssText = "margin-bottom:16px;line-height:1.5;";
    msg.textContent = message;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";

    // Loop 4 UX-02: secondary (Cancel) を左、primary (OK) を右に統一。
    // .confirm-ok クラス経由で layout.css 側で primary 色 (var(--ink)/var(--cream)) を当てる。
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "toggle-btn confirm-cancel";
    cancelBtn.textContent = MESSAGES.ui.actionCancel;

    const okBtn = document.createElement("button");
    okBtn.className = "toggle-btn on confirm-ok";
    okBtn.textContent = MESSAGES.ui.actionOk;

    let trapHandle: { release: () => void } | null = null;
    let inertHandle: { release: () => void } | null = null;

    // L5 Task 5: cleanup は resolve 前に overlay.remove() を同期実行する。
    //   setTimeout 等でフェード遅延を入れると Esc 連打や resolve 後の awaitter 側で
    //   一瞬 overlay が残り、二重ダイアログや背面 inert 解除前にユーザーが裏要素を
    //   操作できてしまうため、DOM 撤去は resolve よりも前に必ず終わらせる。
    const cleanup = (ans: boolean): void => {
      trapHandle?.release();
      trapHandle = null;
      inertHandle?.release();
      inertHandle = null;
      // overlay.remove() は setTimeout なしで即時実行 (resolve 直前)
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(ans);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") cleanup(false);
      if (e.key === "Enter") cleanup(true);
    };

    cancelBtn.addEventListener("click", () => cleanup(false));
    okBtn.addEventListener("click", () => cleanup(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener("keydown", onKey);

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    card.appendChild(msg);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    // overlay 表示中は背景を inert 化し、トラップは overlay 内に閉じ込める
    inertHandle = inertBackground([overlay]);
    trapHandle = trapFocus(overlay, okBtn);
  });
}
