// ワールド訪問の時間帯ブロック
export interface VisitBlock {
  world_id: string;
  world_name: string;
  color_hex: string;
  start_hour: number;
  end_hour: number;
  duration_min: number;
  players?: string[];
}

// 1日分のタイムラインレーン
export interface DayLane {
  date: string;
  weekday: string;
  visits: VisitBlock[];
  has_activity: boolean;
}

// 1週間分のタイムラインデータ
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

// メモ内のハイライトマーカー範囲
export interface MarkerSpan {
  start: number;
  end: number;
  kind: "world" | "person";
  text: string;
}

// メモきっとのチップ表示用データ
export interface MemokittoChip {
  label: string;
  category: string;
}

// 写真エントリ（パスと撮影時刻）
export interface PhotoEntry {
  file_path: string;
  hour: number;
}

// ユーザー作成の手動マーカー
export interface ManualMarker {
  id: number;
  start: number;
  end: number;
  color: string;
}

// 日別フォーカス画面の全データ
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

// カレンダーに表示するイベント
export interface CalendarEvent {
  id: number;
  title: string;
  scheduled_at: string;
  remind_minutes_before: number;
}

// 月別データ（アクティブ日とイベント一覧）
export interface MonthData {
  year: number;
  month: number;
  active_days: number[];
  events: CalendarEvent[];
}

// アプリ起動時に取得する初期情報
export interface StartupInfo {
  stella_connected: boolean;
  pending_notifications: ScheduleNotification[];
  pending_review: string | null;
  onboarding_needed: boolean;
}

// スケジュール通知の表示データ
export interface ScheduleNotification {
  title: string;
  scheduled_at: string;
  event_type: string;
}

// アプリ全体の設定値
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

// リマインダー発火時のイベントデータ
export interface ReminderEvent {
  id: number;
  title: string;
  scheduled_at: string;
  event_type: string;
  minutes_until: number;
}

// ナビゲーションタブの識別子
export type TabId = "home" | "calendar" | "settings" | "debug";
