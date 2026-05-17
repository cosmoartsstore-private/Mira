// localStorage アクセスの集約モジュール (Loop 6 refactor / Loop 9 R2-M-20 整理)。
//
// 散在していた `localStorage.getItem`/`setItem` 呼出を以下の用途別ヘルパーに置換することで、
//   - キー名 (`pending_mark_review_seen` 等) の typo / 重複定義を防ぐ
//   - try/catch + パース失敗フォールバックを 1 箇所に集約する
//   - 将来 localStorage 以外のストレージ (Tauri Store / Settings DB) に差し替える際の
//     置換点を 1 ファイルに閉じ込める
// という 3 つの利点が得られる。
//
// 注意 (Loop 9 R2-M-20):
//   - 旧 `remind_minutes_before_default` の localStorage キャッシュは撤去済。
//     `MiraSettings.remind_minutes_before_default` (DB 直結) に統合された。
//     旧キー `mira:remind_minutes_before_default` が残っているケースに備え、
//     起動時に 1 度だけ DB へ移送する `migrateRemindDefaultFromLocalStorage()` を提供する
//     (app.ts startup から呼ばれ、成功したら localStorage キーを削除する)。
//   - `pending_mark_review_seen` は markReviewSeen API 失敗時のリトライキュー (R2-H-5 補強)。
//     localStorage が破損していた場合の自然な救済として、parse 失敗時は空配列で復帰する。

import { invoke } from "@tauri-apps/api/core";

// === remind_minutes_before_default migration shim ===========================

// Loop 9 R2-M-20: 旧 Loop 1〜6 で使っていた localStorage キャッシュキー。
// 既存ユーザーが localStorage に値を持っている場合のみ DB へ移送するため保持している。
// 移送完了後は localStorage から削除されるため、新規インストールでは存在しない。
const LEGACY_REMIND_DEFAULT_STORAGE_KEY = "mira:remind_minutes_before_default";
// SettingsPage / CalendarPage の選択肢と一致させる (許容値以外は移送スキップ)
const REMIND_ALLOWED_VALUES: readonly number[] = [5, 10, 15, 20, 30, 60];

// 旧 localStorage キャッシュ ("mira:remind_minutes_before_default") から DB へ
// 1 度だけ移送するシム。app.ts の startup から fire-and-forget で呼ばれる。
//
// - 旧キーが存在しない → 何もしない (新規インストール or 既に移送済)
// - 旧キーが許容範囲外 / parse 不能 → 値を破棄して localStorage キーだけ削除
// - 旧キーが許容範囲内 → `set_setting` で DB に書込 → 成功時のみ localStorage キー削除
//
// 既存ユーザーが Loop 9 アップデート後に Settings で設定値を失わないことを保証する。
// 失敗時もログ出力のみで起動を妨げない (次回起動でリトライされる)。
export async function migrateRemindDefaultFromLocalStorage(): Promise<void> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LEGACY_REMIND_DEFAULT_STORAGE_KEY);
  } catch {
    // プライベートブラウジング等で localStorage 自体に触れない場合は黙って終了
    return;
  }
  if (raw === null) return;

  const n = Number(raw);
  if (!Number.isFinite(n) || !REMIND_ALLOWED_VALUES.includes(n)) {
    // 値が壊れている場合はキーだけ掃除して終了 (DB はバックエンド既定値のまま)
    try {
      localStorage.removeItem(LEGACY_REMIND_DEFAULT_STORAGE_KEY);
    } catch {
      /* localStorage 失敗は致命ではないので無視 */
    }
    return;
  }

  try {
    await invoke("set_setting", {
      key: "remind_minutes_before_default",
      value: String(n),
    });
    // DB 書込成功時のみ localStorage キーを削除 (失敗時は次回起動でリトライさせる)
    try {
      localStorage.removeItem(LEGACY_REMIND_DEFAULT_STORAGE_KEY);
    } catch {
      /* localStorage 失敗は致命ではないので無視 */
    }
  } catch (err) {
    console.error("[storage] migrateRemindDefaultFromLocalStorage failed:", err);
  }
}

// === pending_mark_review_seen (R2-H-5 リトライキュー) ========================

const PENDING_MARK_REVIEW_SEEN_KEY = "pending_mark_review_seen";

// 失敗した markReviewSeen キーのリトライキューを読む。
// 壊れた JSON / 非配列の場合は空配列を返し、呼出側で renormalize する余地を残す。
export function getPendingMarkReviewSeen(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_MARK_REVIEW_SEEN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // 配列中の非文字列要素を除外 (将来 schema を変えてもクラッシュしないため)
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

// 失敗した markReviewSeen キーのリトライキューを書き戻す。
// 空配列なら localStorage 上のキーごと削除して掃除する (起動時 parse コスト低減)。
export function setPendingMarkReviewSeen(list: string[]): void {
  try {
    if (list.length === 0) {
      localStorage.removeItem(PENDING_MARK_REVIEW_SEEN_KEY);
      return;
    }
    localStorage.setItem(PENDING_MARK_REVIEW_SEEN_KEY, JSON.stringify(list));
  } catch (err) {
    console.error("[storage] setPendingMarkReviewSeen failed:", err);
  }
}
