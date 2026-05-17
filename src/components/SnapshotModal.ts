import type { SnapshotSummary } from "../state/types";
import { escapeHtml as esc } from "../utils/html";
import { formatNumber } from "../utils/datetime";
import { trapFocus, inertBackground } from "../utils/focusTrap";
import { MESSAGES } from "../utils/messages";

// スナップショット集計を表示する簡易モーダル
export function showSnapshotModal(summary: SnapshotSummary, onClose: () => void): void {
  document.querySelector(".snapshot-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "snapshot-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", esc(summary.label));

  const modal = document.createElement("div");
  modal.className = "snapshot-modal";
  modal.innerHTML = `
    <div class="snapshot-modal-head">
      <div class="snapshot-modal-title">${esc(summary.label)}</div>
      <button class="snapshot-modal-close" aria-label="${MESSAGES.ui.closeModal}">&times;</button>
    </div>
    <div class="snapshot-modal-period">${esc(summary.period_start)} 〜 ${esc(summary.period_end)}</div>
    <div class="snapshot-modal-stats">
      <div class="snapshot-stat"><div class="lbl">予定</div><div class="val"><span class="num">${formatNumber(summary.event_count)}</span>件</div></div>
      <div class="snapshot-stat"><div class="lbl">メモ日数</div><div class="val"><span class="num">${formatNumber(summary.memo_day_count)}</span>日</div></div>
      <div class="snapshot-stat"><div class="lbl">文字数</div><div class="val"><span class="num">${formatNumber(summary.memo_char_total)}</span>字</div></div>
    </div>
  `;

  // close 時の状態解除を漏れなく呼べるよう、focusTrap と inert の release をまとめて保持する
  let trapHandle: { release: () => void } | null = null;
  let inertHandle: { release: () => void } | null = null;

  // L5 Task 7: 多重 close ガード。Esc → overlay click → closeBtn のような連続発火、
  //   または onClose 内での state 変更経由で close が再帰的に呼ばれた場合、
  //   document.removeEventListener が空打ちになるだけでなく、onClose の二度呼び出し、
  //   フェードアウトアニメーションの中断、release ハンドルの null 化済み再呼出しなど、
  //   見えない race を孕む。closed フラグで一度だけ実行に絞る。
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    onClose();
    overlay.classList.remove("visible");
    trapHandle?.release();
    trapHandle = null;
    inertHandle?.release();
    inertHandle = null;
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
  // overlay 自身は除外して背景を inert 化
  inertHandle = inertBackground([overlay]);
  // フォーカストラップを overlay 内に張る (close ボタンを初期フォーカスにすると Esc 時の挙動が直感的)
  const closeBtn = modal.querySelector<HTMLElement>(".snapshot-modal-close") ?? undefined;
  trapHandle = trapFocus(overlay, closeBtn);
  requestAnimationFrame(() => overlay.classList.add("visible"));
}
