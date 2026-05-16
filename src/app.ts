import { getStartupInfo, getSettings, registerToStellarecord, markReviewSeen, getSnapshotSummary } from "./api/commands";
import { Navbar } from "./components/Navbar";
import { HomePage } from "./pages/home/HomePage";
import { CalendarPage } from "./pages/calendar/CalendarPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { DebugPage } from "./pages/debug/DebugPage";
import { activeTab, focusedDate, settings, stellaConnected, notifications, Subscriptions } from "./state/store";
import { playTransition } from "./animations/transition";
import { showStartupReminder } from "./components/StartupReminder";
import { showSnapshotModal } from "./components/SnapshotModal";
import { startReminderService } from "./services/reminder";
import { escapeHtml } from "./utils/html";
import type { TabId } from "./state/types";

// アプリの起動シーケンス: ナビ・ページコンテナを構築 → 起動情報・設定取得 → 初期ページ mount。
// バックエンドが落ちている (STELLA 未接続) ケースは try/catch で握りつぶし、空状態画面で動かす。
export async function initApp(): Promise<void> {
  const app = document.getElementById("app")!;

  const navbar = Navbar();
  const pageContainer = document.createElement("main");
  pageContainer.className = "page-container";

  app.appendChild(navbar);
  app.appendChild(pageContainer);

  createTransitionCover();

  await loadStartupWithRetry(3, pageContainer);

  let currentPageSubs: Subscriptions | null = null;

  const pages: Record<TabId, (subs: Subscriptions) => HTMLElement> = {
    home: (subs) => HomePage(subs),
    calendar: (subs) => CalendarPage(subs),
    settings: (subs) => SettingsPage(subs),
    debug: (subs) => DebugPage(subs),
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
async function loadStartupWithRetry(maxAttempts: number, pageContainer: HTMLElement): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    renderStartupPlaceholder(pageContainer, attempt, maxAttempts);
    try {
      const startupInfo = await getStartupInfo();
      stellaConnected.set(startupInfo.stella_connected);
      notifications.set(startupInfo.pending_notifications);

      const userSettings = await getSettings();
      settings.set(userSettings);
      document.documentElement.style.setProperty("--memo-font", `"${userSettings.font_family}", sans-serif`);
      document.documentElement.classList.toggle("font-scope-all", userSettings.font_scope === "all");
      document.documentElement.classList.toggle("font-scope-content", userSettings.font_scope === "content_only");
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
      registerToStellarecord().catch(() => {});
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
    markReviewSeen(key).catch(() => {});
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
        markReviewSeen(key).catch(() => {});
      });
    } catch {
      // 失敗してもユーザー体験を妨げないため既読扱いにする
      markReviewSeen(key).catch(() => {});
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