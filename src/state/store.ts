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

  // 値を更新して全リスナーに新値・旧値を通知する。
  // - 参照同一 (`Object.is`) の場合は通知をスキップして無駄な再描画を避ける。
  // - リスナーの 1 つが throw しても後続リスナーは継続実行する。
  set(next: T): void {
    if (Object.is(next, this.value)) return;
    const prev = this.value;
    this.value = next;
    this.notify(next, prev);
  }

  // 複数フィールドを 1 回の通知でまとめて更新する (オブジェクト型 T 限定の merge update)。
  // `set({ ...this.value, ...updates })` を 2 回呼ぶと notify が 2 回走ってしまうケース向け。
  // - T が object でなければ TypeScript 側で `Partial<T>` が `never`/不正になるため誤用を弾ける。
  // - 全フィールドの差分が無ければ通知ごと skip し、無駄な再描画を避ける。
  // - 内部的には set() と同じく Object.is で参照同一性を見るが、merge 結果が新参照になるため
  //   各フィールドが実質変化したかは `Object.is(prev[k], next[k])` で個別判定する。
  batchSet(updates: Partial<T>): void {
    // T が object 以外 (string 等) の場合、Partial<T> は呼出側で型エラーになる想定だが、
    // ランタイム保護として typeof チェックを入れておく。
    if (this.value === null || typeof this.value !== "object") {
      throw new TypeError("[Store] batchSet requires an object-typed Store value");
    }
    const prev = this.value;
    // 1 つでも実質変化があるかチェック (Object.is で参照/プリミティブ比較)。
    let changed = false;
    for (const key of Object.keys(updates) as (keyof T)[]) {
      const nextVal = updates[key];
      if (nextVal !== undefined && !Object.is((prev as T)[key], nextVal)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    // Partial<T> の undefined フィールドはスプレッド時に上書きされてしまうため、
    // 明示的にフィルタしてから merge する。
    const filtered: Partial<T> = {};
    for (const key of Object.keys(updates) as (keyof T)[]) {
      if (updates[key] !== undefined) {
        filtered[key] = updates[key];
      }
    }
    const next = { ...prev, ...filtered } as T;
    this.value = next;
    this.notify(next, prev);
  }

  // listeners への通知共通処理。throw した listener は console.error に吐いて後続を続行。
  //
  // L4 R4-Err-12: throw した listener はその場で `listeners` から取り除く。
  //   毎回 set() のたびに同じ例外を投げ続けると console が無限ループの様に汚染され、
  //   かつ重い throw コストがメインスレッドを詰まらせる。1 度 throw した listener は
  //   壊れているとみなして自動 unsubscribe する (subscribe 戻り値の手動 unsub は呼び続けても
  //   Set.delete が冪等なので副作用なし)。
  //
  //   通知中に listeners を改変するとループの動作が崩れるため、削除候補を一時 Set に貯めて
  //   ループ後に一括 delete する。
  private notify(next: T, prev: T): void {
    let toRemove: Set<Listener<T>> | undefined;
    this.listeners.forEach((fn) => {
      try {
        fn(next, prev);
      } catch (err) {
        // 後続リスナーをブロックしないようコンソールにのみ吐く
        console.error("[Store] listener threw, auto-unsubscribing:", err);
        toRemove ??= new Set();
        toRemove.add(fn);
      }
    });
    if (toRemove) {
      for (const fn of toRemove) {
        this.listeners.delete(fn);
      }
    }
  }

  // 変更を購読し、解除関数を返す。
  // 注意: 登録時には発火しない（初期値を拾いたい場合は別途 get() を呼ぶか
  // [`Store.subscribeImmediate`] を使う）。
  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // 登録と同時に現在値で 1 度発火し、その後の変更も購読する。
  // pendingFocus のような「購読登録より前に set された値」を呼出側で拾い直さなくて済む。
  subscribeImmediate(fn: Listener<T>): () => void {
    const unsub = this.subscribe(fn);
    fn(this.value, this.value);
    return unsub;
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

// 表示中の週の開始日（月曜始まり、YYYY-MM-DD）。DEV では固定日でデータが見えるようにしてある。
export const currentWeekStart = new Store<string>(import.meta.env.DEV ? "2026-04-19" : getMonday());

// CalendarPage で表示中の年月
export const currentMonth = new Store<{ year: number; month: number }>({
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
});

// アプリ全体設定。getSettings() で DB から差し替わるまでの暫定値。
//
// Loop 6 task6 リスク回避: 初期値を null 化して読込中 UI を出す案も検討したが、
//   既存ページ (HomePage/SettingsPage 等) が同期的に `settings.get()` を呼ぶ箇所が多く、
//   null チェックを全箇所に伸ばすと差分が大きく拡散するため hardcode を維持する。
//   バックエンド get_settings 成功時に app.ts:loadStartupWithRetry が settings.set() で
//   全フィールドを上書きするため、暫定値が画面に残留するのは初回数百 ms のみ。
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
  // Loop 9 R2-M-20: 既定リマインド分数も MiraSettings に統合済。
  // 暫定値 15 はバックエンド `get_settings` 成功時に上書きされる (DB 既定も 15)。
  remind_minutes_before_default: 15,
});

// StellaRecord DB に接続できているか（HomePage の空状態判定に使う）
export const stellaConnected = new Store<boolean>(false);

// 起動時に取得した今日〜1 週間以内の予定通知。レーン上のピン表示に使う。
export const notifications = new Store<ScheduleNotification[]>([]);

// ページ単位の購読解除をまとめて行うためのコレクター。
// 各ページコンポーネントは subs を受け取り、unmount 時に app.ts が dispose() する。
export class Subscriptions {
  private unsubs: (() => void)[] = [];

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
