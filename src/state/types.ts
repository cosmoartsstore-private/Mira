// バックエンド (Rust serde) と一致させる型定義。フィールド名はそのまま snake_case。

// ワールド訪問の時間帯ブロック。hour は 0..30 の小数（24+ で深夜越え対応）。
export interface VisitBlock {
  world_id: string;
  world_name: string;
  color_hex: string;
  start_hour: number;
  end_hour: number;
  duration_min: number;
  players?: string[];
}

// 1日分のタイムラインレーン（週表示用）
export interface DayLane {
  date: string;
  weekday: string;
  visits: VisitBlock[];
  has_activity: boolean;
}

// 1週間分のタイムラインデータ。hour_start/hour_end は描画範囲（time_range.rs で算出）。
export interface WeekLaneData {
  lanes: DayLane[];
  hour_start: number;
  hour_end: number;
}

// 一緒に訪問した人のチップ表示用データ
export interface PersonChip {
  user_id: string;
  display_name: string;
  is_favorite: boolean;
  co_visit_count: number;
}

// メモ内の自動検出マーカー範囲。
// start/end は **UTF-16 コードユニット位置** (JS 文字列インデックス互換)。
// Rust 側は UTF-8 バイト位置から変換して返す (logic/marker.rs)。
export interface MarkerSpan {
  start: number;
  end: number;
  kind: "world" | "person";
  text: string;
}

// めもきっとチップ（ワールド名/ユーザー名）
export interface MemokittoChip {
  label: string;
  category: string;
}

// 写真エントリ。hour は 0..24+ の小数で撮影時刻
export interface PhotoEntry {
  file_path: string;
  hour: number;
}

// ユーザー作成の手動マーカー。
// start/end は UTF-16 コードユニット位置（フロントの getSelectionOffsets と整合）。
export interface ManualMarker {
  id: number;
  start: number;
  end: number;
  color: string;
}

// 日別フォーカス画面の全データ（メモ・統計・写真・マーカー）
export interface DayFocusData {
  date: string;
  date_label: string;
  visits: VisitBlock[];
  total_duration_min: number;
  people_count: number;
  photos: PhotoEntry[];
  photo_count: number;
  memo: string | null;
  memo_markers: MarkerSpan[];
  manual_markers: ManualMarker[];
  memokitto: MemokittoChip[];
  has_update: boolean;
}

// カレンダーに表示するユーザー登録イベント
export interface CalendarEvent {
  id: number;
  title: string;
  scheduled_at: string;
  remind_minutes_before: number;
}

// 月別データ（アクティブ日・イベント一覧）
export interface MonthData {
  year: number;
  month: number;
  active_days: number[];
  events: CalendarEvent[];
}

// アプリ起動時に取得する初期情報（接続状態・通知・遷移誘導フラグ）
export interface StartupInfo {
  stella_connected: boolean;
  pending_notifications: ScheduleNotification[];
  pending_review: string | null;
  onboarding_needed: boolean;
}

// 起動時に表示する予定通知の最小表示データ
export interface ScheduleNotification {
  title: string;
  scheduled_at: string;
  event_type: string;
}

// アプリ全体の設定値（DB の mira_settings テーブルと対応）
export interface MiraSettings {
  font_family: string;
  font_scope: string;
  memo_max_length: number;
  transition_enabled: boolean;
  snapshot_enabled: boolean;
  onboarding_completed: boolean;
  voicevox_enabled: boolean;
  voice_character: string;
  reminder_sound_enabled: boolean;
}

// リマインダー発火時のイベントデータ（ポーリングで取得）
export interface ReminderEvent {
  id: number;
  title: string;
  scheduled_at: string;
  event_type: string;
  minutes_until: number;
}

// ナビゲーションタブの識別子（debug は DEV ビルドのみ表示）
export type TabId = "home" | "calendar" | "settings" | "debug";
