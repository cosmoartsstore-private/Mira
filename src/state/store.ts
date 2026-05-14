import type { TabId, MiraSettings, ScheduleNotification } from "./types";

// ストア変更時のコールバック型（新値・旧値を受け取る）
type Listener<T> = (value: T, prev: T) => void;

// 値を保持しつつ変更を購読できるシンプルなリアクティブストア。
// クラス採用は単一値+リスナー集合のカプセル化のため。RxJS等は重すぎる用途なので避けている。
export class Store<T> {
  private value: T;
  private listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  // 現在の値を返す（同期的・副作用なし）
  get(): T {
    return this.value;
  }

  // 値を更新して全リスナーに新値・旧値を通知する
  set(next: T): void {
    const prev = this.value;
    this.value = next;
    this.listeners.forEach((fn) => fn(next, prev));
  }

  // 変更を購読し、解除関数を返す。
  // 注意: 登録時には発火しない（初期値を拾いたい場合は別途 get() を呼ぶ）。
  // CalendarPage → HomePage の遷移など、購読登録より前に set() された値はこの仕様で零れる。
  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// 今週の月曜日（ISO週始まり）のローカル日付文字列を返す
export function getMonday(): string {
  const d = new Date();
  const day = d.getDay();
  // 日曜(0)を週末扱いにし、月曜始まりへのオフセットを計算
  const offset = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  // toISOString は UTC 化されローカル日付とずれるため、ローカルでゼロ埋めフォーマット
  const y = monday.getFullYear();
  const MM = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${y}-${MM}-${dd}`;
}

// 現在アクティブなナビゲーションタブ
export const activeTab = new Store<TabId>("home");

// HomePage でフォーカス中の日付（null なら週ビュー、文字列なら詳細ビュー）
export const focusedDate = new Store<string | null>(null);

// 表示中の週の開始日（日曜日、YYYY-MM-DD）。DEV では固定日でデータが見えるようにしてある。
export const currentWeekStart = new Store<string>(
  import.meta.env.DEV ? "2026-04-19" : getMonday()
);

// CalendarPage で表示中の年月
export const currentMonth = new Store<{ year: number; month: number }>({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
});

// アプリ全体設定。getSettings() で DB から差し替わるまでの暫定値
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
  view_hour_start: 0,
  view_hour_end: 24,
});

// STELLARecord DB に接続できているか（HomePage の空状態判定に使う）
export const stellaConnected = new Store<boolean>(false);

// 起動時に取得した今日〜1週間以内の予定通知。レーン上のピン表示に使う。
export const notifications = new Store<ScheduleNotification[]>([]);

// ページ単位の購読解除をまとめて行うためのコレクター。
// 各ページコンポーネントは subs を受け取り、unmount 時に app.ts が dispose() する。
export class Subscriptions {
  private unsubs: Array<() => void> = [];

  // 解除関数を1つ登録する
  add(unsub: () => void): void {
    this.unsubs.push(unsub);
  }

  // 登録済みの全解除関数を呼んでリストをクリアする
  dispose(): void {
    for (const fn of this.unsubs) fn();
    this.unsubs.length = 0;
  }
}