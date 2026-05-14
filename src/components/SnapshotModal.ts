import type { SnapshotSummary } from "../state/types";

// スナップショット集計を表示する簡易モーダル
export function showSnapshotModal(summary: SnapshotSummary, onClose: () => void): void {
  document.querySelector(".snapshot-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "snapshot-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "snapshot-modal";
  modal.innerHTML = `
    <div class="snapshot-modal-head">
      <div class="snapshot-modal-title">${escHtml(summary.label)}</div>
      <button class="snapshot-modal-close">&times;</button>
    </div>
    <div class="snapshot-modal-period">${escHtml(summary.period_start)} 〜 ${escHtml(summary.period_end)}</div>
    <div class="snapshot-modal-stats">
      <div class="snapshot-stat"><div class="lbl">予定</div><div class="val"><span class="num">${summary.event_count}</span>件</div></div>
      <div class="snapshot-stat"><div class="lbl">メモ日数</div><div class="val"><span class="num">${summary.memo_day_count}</span>日</div></div>
      <div class="snapshot-stat"><div class="lbl">文字数</div><div class="val"><span class="num">${summary.memo_char_total}</span>字</div></div>
    </div>
  `;

  const close = () => {
    onClose();
    overlay.classList.remove("visible");
    setTimeout(() => overlay.remove(), 300);
    document.removeEventListener("keydown", keyHandler);
  };

  function keyHandler(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  modal.querySelector(".snapshot-modal-close")!.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
  });
  modal.addEventListener("click", (e) => e.stopPropagation());
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", keyHandler);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("visible"));
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}