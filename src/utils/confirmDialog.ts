// 標準 `window.confirm` の代替。Tauri WebView2 でブロッキング系 dialog API が
// 抑制されることがあるため、自前のオーバーレイ + ボタンで Promise<boolean> を返す。
// Esc: キャンセル / Enter: OK / オーバーレイクリック: キャンセル。
export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "mira-confirm-overlay";
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

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "toggle-btn";
    cancelBtn.textContent = "キャンセル";

    const okBtn = document.createElement("button");
    okBtn.className = "toggle-btn on";
    okBtn.textContent = "OK";

    const cleanup = (ans: boolean) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(ans);
    };
    const onKey = (e: KeyboardEvent) => {
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
    okBtn.focus();
  });
}
