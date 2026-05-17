import {
  getStartupInfo,
  getSettings,
  registerToStellarecord,
  markReviewSeen,
  getSnapshotSummary,
} from "./api/commands";
import { Navbar } from "./components/Navbar";
import { HomePage } from "./pages/home/HomePage";
import { CalendarPage } from "./pages/calendar/CalendarPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import {
  activeTab,
  focusedDate,
  settings,
  stellaConnected,
  notifications,
  Subscriptions,
} from "./state/store";
import { playTransition } from "./animations/transition";
import { showStartupReminder } from "./components/StartupReminder";
import { showSnapshotModal } from "./components/SnapshotModal";
import { startReminderService } from "./services/reminder";
import { escapeHtml, errMessage } from "./utils/html";
import { showToast } from "./utils/toast";
import { MESSAGES } from "./utils/messages";
import {
  getPendingMarkReviewSeen,
  setPendingMarkReviewSeen,
  migrateRemindDefaultFromLocalStorage,
} from "./utils/storage";
import { formatDate } from "./utils/datetime";
import type { TabId } from "./state/types";

// L7 Pub: ウィンドウタイトル ("Mira - 今日" 等) を activeTab/focusedDate に追従させる。
//   タブ別の固定ラベルマップ。debug タブは DEV のみ表示されるためフォールバックを用意する。
const TAB_TITLE_LABELS: Record<TabId, string> = {
  home: "今日",
  calendar: "カレンダー",
  settings: "設定",
  debug: "デバッグ",
};

// activeTab と focusedDate から "Mira - <suffix>" 形式のタイトル文字列を組み立てる。
// home タブで focusedDate が立っている場合は日付 (M/D) を優先表示し、それ以外はタブラベル。
// focusedDate が "YYYY-MM-DD" 形式でパース不能 (=不正) なら "今日" にフォールバックする。
function buildWindowTitle(tab: TabId, focused: string | null): string {
  if (tab === "home" && focused) {
    const d = new Date(`${focused}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return `Mira - ${formatDate(d)}`;
    }
  }
  return `Mira - ${TAB_TITLE_LABELS[tab]}`;
}

// markReviewSeen 失敗時のリトライキュー (R2-H-5 補強)。
// localStorage アクセス自体は utils/storage に集約し、ここでは取得 → 重複排除 → 上限切り詰めの
// ビジネスロジックに集中する。
// L5 Mem: 永続キューが暴走しないよう保持上限を設ける。
//   バックエンドが長期間落ちている等で大量に失敗し続けても、localStorage を食い潰さない。
//   100 件を超えたら古い方 (push 順で先頭) から捨てる FIFO 方式。
//   通常運用 (Q4 + annual の 2 件程度) ではまず到達しない閾値。
const PENDING_MARK_REVIEW_SEEN_MAX = 100;

// 失敗した markReviewSeen のキーを localStorage の待ち行列に追記する (重複は無視)。
function enqueuePendingMarkReviewSeen(key: string): void {
  try {
    const list = getPendingMarkReviewSeen();
    if (!list.includes(key)) {
      list.push(key);
      // L5 Mem: 上限を超えたら古い順に切り落として保存する (FIFO)
      while (list.length > PENDING_MARK_REVIEW_SEEN_MAX) {
        list.shift();
      }
      setPendingMarkReviewSeen(list);
    }
  } catch (err) {
    console.error("[markReviewSeen] enqueue failed:", err);
  }
}

// markReviewSeen をリトライ機構付きで呼び出す。
// 成功: 何もしない。失敗: localStorage に積み、ユーザー向けにトースト表示。
function markReviewSeenWithRetry(key: string): void {
  markReviewSeen(key).catch((e: unknown) => {
    enqueuePendingMarkReviewSeen(key);
    showToast({
      kind: "error",
      title: MESSAGES.review.seenFailedTitle,
      body: MESSAGES.review.seenFailedBody(errMessage(e)),
    });
  });
}

// 起動時に呼び出し、前回失敗した markReviewSeen を再試行する。
// 成功したキーから個別に取り除き、残ったキーは次回起動でも再試行できるよう保持する。
//
// 永続層は utils/storage に集約しており、getPendingMarkReviewSeen は壊れた JSON や
// 非配列も空配列に正規化して返すため、ここでは parse 失敗ハンドリングを書かない。
async function flushPendingMarkReviewSeen(): Promise<void> {
  const list = getPendingMarkReviewSeen();
  if (list.length === 0) return;

  const remaining: string[] = [];
  for (const key of list) {
    try {
      await markReviewSeen(key);
    } catch (err) {
      console.error("[markReviewSeen] retry failed:", key, err);
      remaining.push(key);
    }
  }
  // L5 Mem: 旧版が保存した古いキュー等で上限超過しているケースに備え、
  //   保存し直す際にも FIFO で切り詰めて最新の失敗を優先保持する。
  while (remaining.length > PENDING_MARK_REVIEW_SEEN_MAX) {
    remaining.shift();
  }
  // setPendingMarkReviewSeen は空配列を渡すと localStorage キーを削除する仕様
  setPendingMarkReviewSeen(remaining);
}

// L4 R4-Err-3: 既存の try/catch で拾えなかった非同期エラーと同期エラーを最後に拾う網。
//   1) `unhandledrejection`: await されずに reject された Promise (= 無音失敗)
//   2) `onerror`            : window スコープで投げられた同期例外 (handler 内 throw 等)
//   いずれも console に詳細を残しつつ、ユーザーには簡潔な warn トーストで気付かせる
//   (詳細メッセージは含めず、開発者ツールでの確認を促す)。
//
//   多重発火対策: 同じ秒で大量に飛んでくる可能性があるため、トースト本体は
//   showToast 側の重複抑止 (.app-toast の単一表示) に任せる。
let globalErrorHandlersRegistered = false;
function registerGlobalErrorHandlers(): void {
  if (globalErrorHandlersRegistered) return;
  globalErrorHandlersRegistered = true;
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    console.error("[unhandled] promise rejection:", e.reason);
    showToast({
      kind: "error",
      title: MESSAGES.errors.unexpectedErrorTitle,
      body: MESSAGES.errors.unexpectedErrorBody,
    });
  });
  window.addEventListener("error", (e: ErrorEvent) => {
    console.error("[unhandled] window error:", e.error ?? e.message);
    showToast({
      kind: "error",
      title: MESSAGES.errors.unexpectedErrorTitle,
      body: MESSAGES.errors.unexpectedErrorBody,
    });
  });
}

// アプリの起動シーケンス: ナビ・ページコンテナを構築 → 起動情報・設定取得 → 初期ページ mount。
// バックエンドが落ちている (STELLA 未接続) ケースは try/catch で握りつぶし、空状態画面で動かす。
export async function initApp(): Promise<void> {
  const app = document.getElementById("app")!;

  // L4 R4-Err-3: 個別 try/catch を逃れたエラーをユーザーに知らせる最終防衛線。
  //   initApp 内で 1 回だけ登録する (HMR で再 mount しても 2 重登録しないようガード)。
  registerGlobalErrorHandlers();

  // 前回起動時に失敗した markReviewSeen を最優先で再試行 (await はせず背景で進める)
  void flushPendingMarkReviewSeen();

  // Loop 9 R2-M-20: 旧 localStorage キャッシュ ("mira:remind_minutes_before_default") を
  // DB へ 1 度だけ移送する。`loadStartupWithRetry` (= getSettings 呼出) より前に
  // **await** してから getSettings を呼ばないと、移送した値が初回 settings.set() に
  // 反映されない (旧版から更新したユーザーが Settings 値を 1 起動だけ失ったように見える)。
  // 移送が失敗しても起動は止めず、次回起動でリトライさせる (shim 内で握りつぶし済)。
  await migrateRemindDefaultFromLocalStorage();

  const navbar = Navbar();
  const pageContainer = document.createElement("main");
  pageContainer.className = "page-container";

  app.appendChild(navbar);
  app.appendChild(pageContainer);

  createTransitionCover();

  await loadStartupWithRetry(3, pageContainer);

  let currentPageSubs: Subscriptions | null = null;

  // R2-H-6: DebugPage は本番 bundle から除外したいので、レコードには載せず DEV 時のみ
  // dynamic import で読み込む。production build では `import.meta.env.DEV === false` が
  // 定数置換され、import 行ごと tree-shake で消える。
  const pages: Record<Exclude<TabId, "debug">, (subs: Subscriptions) => HTMLElement> = {
    home: (subs) => HomePage(subs),
    calendar: (subs) => CalendarPage(subs),
    settings: (subs) => SettingsPage(subs),
  };

  // タブ切替時に旧ページの購読を解除し、新ページを生成・差し替える。
  // focusedDate は home 専用のため、home 以外に行く時だけ消す（CalendarPage が事前にセットして
  // home に飛ばすフローを壊さないため）。
  function mountPage(tab: TabId): void {
    if (currentPageSubs) {
      currentPageSubs.dispose();
    }
    if (tab !== "home") {
      focusedDate.set(null);
    }
    currentPageSubs = new Subscriptions();
    pageContainer.innerHTML = "";
    if (tab === "debug") {
      // DEV のみロード。production では Navbar に debug タブ自体出ない (Navbar 側 DEV ガード)
      if (import.meta.env.DEV) {
        const subs = currentPageSubs;
        const target = pageContainer;
        void import("./pages/debug/DebugPage")
          .then(({ DebugPage }) => {
            // 非同期ロード中にタブが切り替わっていた場合は描画しない
            if (currentPageSubs !== subs) return;
            target.appendChild(DebugPage(subs));
          })
          .catch((e: unknown) => {
            // 動的 import 失敗 (chunk 404 等) を握りつぶさず DEV コンソールに残す
            console.error("[debug] import failed:", e);
          });
      }
      return;
    }
    pageContainer.appendChild(pages[tab](currentPageSubs));
  }

  activeTab.subscribe(async (newTab, oldTab) => {
    if (oldTab === newTab) return;
    if (settings.get().transition_enabled) {
      // カバーで覆ってから mount するため、ページ切替のチラつきが見えない
      await playTransition(newTab, () => mountPage(newTab));
    } else {
      mountPage(newTab);
    }
  });

  // L7 Pub: ウィンドウ (タスクバー) タイトルを activeTab / focusedDate に追従させる。
  //   subscribeImmediate で初期値 ("Mira - 今日") も即反映する。
  //   グローバル購読 (mountPage の Subscriptions に乗せない) — アプリ全体ライフサイクルに従う。
  const updateTitle = (): void => {
    document.title = buildWindowTitle(activeTab.get(), focusedDate.get());
  };
  activeTab.subscribeImmediate(updateTitle);
  focusedDate.subscribe(updateTitle);

  mountPage("home");
}

// リトライ中に表示するプレースホルダを描画する
function renderStartupPlaceholder(pageContainer: HTMLElement, attempt: number, max: number): void {
  pageContainer.innerHTML = `
    <div class="empty-state startup-loading">
      <div class="empty-state-icon">✦</div>
      <p class="empty-state-message">起動情報を読み込み中… (試行 ${attempt}/${max})</p>
    </div>
  `;
}

// 起動情報取得に失敗したら N 秒後にリトライ (最大3回)
async function loadStartupWithRetry(
  maxAttempts: number,
  pageContainer: HTMLElement,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    renderStartupPlaceholder(pageContainer, attempt, maxAttempts);
    try {
      // getStartupInfo と getSettings は互いに独立しているので並列に投げて起動時間を短縮する
      const [startupInfo, userSettings] = await Promise.all([getStartupInfo(), getSettings()]);
      stellaConnected.set(startupInfo.stella_connected);
      notifications.set(startupInfo.pending_notifications);

      settings.set(userSettings);
      document.documentElement.style.setProperty(
        "--memo-font",
        `"${userSettings.font_family}", sans-serif`,
      );
      document.documentElement.classList.toggle(
        "font-scope-all",
        userSettings.font_scope === "all",
      );
      document.documentElement.classList.toggle(
        "font-scope-content",
        userSettings.font_scope === "content_only",
      );
      document.body.classList.toggle("transitions-disabled", !userSettings.transition_enabled);

      pageContainer.innerHTML = "";

      if (startupInfo.pending_notifications.length > 0) {
        setTimeout(() => showStartupReminder(startupInfo.pending_notifications), 1200);
      }

      if (startupInfo.pending_review) {
        const key = startupInfo.pending_review;
        setTimeout(() => showReviewToast(key), 1800);
      }

      startReminderService();
      // R2-H-5: 自動登録失敗を無音で握りつぶさず、ユーザーに簡潔に通知する
      registerToStellarecord().catch((e: unknown) => {
        showToast({
          kind: "error",
          title: MESSAGES.errors.stellaAutoRegisterFailedTitle,
          body: MESSAGES.errors.stellaAutoRegisterFailedBody(errMessage(e)),
        });
      });
      return;
    } catch {
      if (attempt >= maxAttempts) {
        // 最終失敗時は HomePage の empty state に合流させるためコンテナをクリア
        // (stellaConnected=false のままなので HomePage 側の再接続 UI が表示される)
        pageContainer.innerHTML = "";
        return;
      }
      // exponential backoff: 1s, 2s, 4s ...
      const wait = 1000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// pending_review キー (snapshot_xxxx-Qn / annual_yyyy) に応じたトースト表示
function showReviewToast(key: string): void {
  document.querySelector(".review-toast")?.remove();

  const isSnapshot = key.startsWith("snapshot_");
  const isAnnual = key.startsWith("annual_");
  if (!isSnapshot && !isAnnual) return;

  const label = isSnapshot
    ? `この四半期のスナップショットが届いています (${key.slice("snapshot_".length)})`
    : `年間レビューが届いています (${key.slice("annual_".length)})`;

  // R2-M-21: 1 月起動時に annual を先に出す現状の逐次フローは維持しつつ、
  // 「次回起動時に Q4 が見られる」旨をユーザーに事前告知する。
  // (1 月 = annual_YYYY をクリック表示する瞬間に、まだ未読の前年 Q4 が残っていることを示唆)
  const isJanuary = new Date().getMonth() === 0;
  const showQ4Hint = isAnnual && isJanuary;

  const toast = document.createElement("div");
  toast.className = "review-toast reminder-toast";
  toast.innerHTML = `
    <div class="reminder-toast-icon">&#x2728;</div>
    <div class="reminder-toast-body">
      <div class="reminder-toast-title">${escapeHtml(label)}</div>
      <div class="reminder-toast-sub">タップで詳細を表示・閉じると以降表示しません</div>
    </div>
    <button class="reminder-toast-close">&times;</button>
  `;

  const dismissToast = () => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  };

  const closeAndMark = () => {
    // R2-H-5: 既読化失敗をサイレントで握りつぶさず、localStorage 経由で次回起動時に再試行する
    markReviewSeenWithRetry(key);
    dismissToast();
  };

  toast.querySelector(".reminder-toast-close")!.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAndMark();
  });

  toast.addEventListener("click", async () => {
    dismissToast();
    try {
      const summary = await getSnapshotSummary(key);
      showSnapshotModal(summary, () => {
        // 失敗時は localStorage に積んで次回起動で再試行
        markReviewSeenWithRetry(key);
      });
      // R2-M-21: annual モーダル末尾相当の文言。SnapshotModal 本体は触らず、
      // モーダル表示直後に補助トーストで「次回起動時に前年 Q4 も表示されます」を伝える。
      if (showQ4Hint) {
        showToast({
          kind: "info",
          title: MESSAGES.review.annualShownTitle,
          body: MESSAGES.review.annualQ4HintBody,
          durationMs: 6000,
        });
      }
    } catch (e: unknown) {
      // R2-C-8: 取得失敗時に強制既読化していた挙動を撤去。
      // 既読化せずエラーを表示し、次回起動時に再試行できるようにする。
      showToast({
        kind: "error",
        title: MESSAGES.review.fetchFailedTitle,
        body: MESSAGES.review.fetchFailedBody(errMessage(e)),
      });
    }
  });

  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
}

// タブ遷移時のスライドカバーを overlay 層に1枚だけ仕込む（playTransition が使い回す）
function createTransitionCover(): void {
  const overlay = document.getElementById("overlay-layer")!;
  const cover = document.createElement("div");
  cover.id = "transition-cover";
  cover.className = "transition-cover";
  cover.innerHTML = `
    <div class="transition-content">
      <div class="transition-logo">Mira</div>
      <div class="transition-divider"></div>
      <div class="transition-label"></div>
    </div>
  `;
  overlay.appendChild(cover);
}
