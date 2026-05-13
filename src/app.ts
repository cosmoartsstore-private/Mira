import { getStartupInfo, getSettings, registerToStellarecord } from "./api/commands";
import { Navbar } from "./components/Navbar";
import { HomePage } from "./pages/home/HomePage";
import { CalendarPage } from "./pages/calendar/CalendarPage";
import { SettingsPage } from "./pages/settings/SettingsPage";
import { DebugPage } from "./pages/debug/DebugPage";
import { activeTab, focusedDate, settings, stellaConnected, notifications, Subscriptions } from "./state/store";
import { playTransition } from "./animations/transition";
import { showStartupReminder } from "./components/StartupReminder";
import { startReminderService } from "./services/reminder";
import type { TabId } from "./state/types";

export async function initApp(): Promise<void> {
  const app = document.getElementById("app")!;

  const navbar = Navbar();
  const pageContainer = document.createElement("main");
  pageContainer.className = "page-container";

  app.appendChild(navbar);
  app.appendChild(pageContainer);

  createTransitionCover();

  try {
    const startupInfo = await getStartupInfo();
    stellaConnected.set(startupInfo.stella_connected);
    notifications.set(startupInfo.pending_notifications);

    const userSettings = await getSettings();
    settings.set(userSettings);
    document.documentElement.style.setProperty("--memo-font", `"${userSettings.font_family}", sans-serif`);

    if (startupInfo.pending_notifications.length > 0) {
      setTimeout(() => showStartupReminder(startupInfo.pending_notifications), 1200);
    }

    startReminderService();

    registerToStellarecord().catch(() => {});
  } catch {
    // STELLARecord not available
  }

  let currentPageSubs: Subscriptions | null = null;

  const pages: Record<TabId, (subs: Subscriptions) => HTMLElement> = {
    home: (subs) => HomePage(subs),
    calendar: (subs) => CalendarPage(subs),
    settings: (subs) => SettingsPage(subs),
    debug: (subs) => DebugPage(subs),
  };

  function mountPage(tab: TabId): void {
    if (currentPageSubs) {
      currentPageSubs.dispose();
    }
    // CalendarPage は home 遷移前に focusedDate をセットするため、ここでは消さない
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
      await playTransition(newTab, () => mountPage(newTab));
    } else {
      mountPage(newTab);
    }
  });

  mountPage("home");
}

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
