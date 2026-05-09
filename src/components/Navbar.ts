import { activeTab } from "../state/store";
import type { TabId } from "../state/types";

export function Navbar(): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "navbar";

  const logo = document.createElement("div");
  logo.className = "navbar-logo";
  logo.textContent = "Mira";

  const tabs = document.createElement("div");
  tabs.className = "navbar-tabs";

  const tabDefs: { id: TabId; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "calendar", label: "Calendar" },
    { id: "settings", label: "Settings" },
    ...(import.meta.env.DEV ? [{ id: "debug" as TabId, label: "Debug" }] : []),
  ];

  for (const def of tabDefs) {
    const btn = document.createElement("button");
    btn.className = "navbar-tab";
    btn.dataset.tab = def.id;
    btn.textContent = def.label;
    btn.addEventListener("click", () => activeTab.set(def.id));
    tabs.appendChild(btn);
  }

  nav.appendChild(logo);
  nav.appendChild(tabs);

  activeTab.subscribe((tab) => {
    tabs.querySelectorAll(".navbar-tab").forEach((el) => {
      (el as HTMLElement).classList.toggle("active", el.getAttribute("data-tab") === tab);
    });
  });

  const initial = tabs.querySelector(`[data-tab="${activeTab.get()}"]`);
  initial?.classList.add("active");

  return nav;
}
