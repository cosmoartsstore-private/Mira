import type { TabId, MiraSettings, ScheduleNotification } from "./types";

// ストア変更時のコールバック型
type Listener<T> = (value: T, prev: T) => void;

// シンプルなリアクティブ状態管理ストア
export class Store<T> {
  private value: T;
  private listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  // 現在の値を取得する
  get(): T {
    return this.value;
  }

  // 値を更新してリスナーに通知する
  set(next: T): void {
    const prev = this.value;
    this.value = next;
    this.listeners.forEach((fn) => fn(next, prev));
  }

  // 変更を購読し、解除関数を返す
  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// 今週の日曜日の日付文字列を返す
export function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return sunday.toISOString().split("T")[0];
}

export const activeTab = new Store<TabId>("home");
export const focusedDate = new Store<string | null>(null);
export const currentWeekStart = new Store<string>(
  import.meta.env.DEV ? "2026-04-19" : getMonday()
);
export const currentMonth = new Store<{ year: number; month: number }>({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
});
export const settings = new Store<MiraSettings>({
  font_family: "Yomogi",
  font_scope: "content_only",
  memo_max_length: 1000,
  transition_enabled: true,
  snapshot_enabled: true,
  onboarding_completed: false,
  voicevox_enabled: false,
  voice_character: "metan",
  reminder_sound_enabled: true,
});
export const stellaConnected = new Store<boolean>(false);
export const notifications = new Store<ScheduleNotification[]>([]);

// ページライフサイクル用の購読解除コレクター
export class Subscriptions {
  private unsubs: Array<() => void> = [];

  // 解除関数を登録する
  add(unsub: () => void): void {
    this.unsubs.push(unsub);
  }

  // 全購読を解除してリストをクリアする
  dispose(): void {
    for (const fn of this.unsubs) fn();
    this.unsubs.length = 0;
  }
}
