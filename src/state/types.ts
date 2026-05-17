// 同席プレイヤー (user_id + 表示名)
export interface VisitPlayer {
  user_id: string;
  name: string;
}

// ワールド訪問の時間帯ブロック (世界色は Mira 側で world_name 基準に生成)
export interface VisitBlock {
  world_name: string;
  color_hex: string;
  start_hour: number;
  end_hour: number;
  duration_min: number;
  players?: VisitPlayer[];
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
  co_visit_count: number;
}

// メモ内の自動検出マーカー範囲。
// start/end は **Unicode scalar (char) 位置** (`Array.from(memo).length` と同単位)。
// L7-MarkerUnit: フロント `getSelectionOffsets` / バックエンド `marker.rs` /
//   `journal.rs` の検証 (`add_manual_marker`) / 永続化 (`manual_markers.start_pos`) を
//   全層 scalar 単位に統一済み。絵文字 (例: "🎉") を含むメモでもずれない。
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
// start/end は **Unicode scalar (char) 位置** (フロントの `getSelectionOffsets` と整合;
// `Array.from(memo).length` と同単位)。
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
}

// カレンダーに表示するユーザー登録イベント
export interface CalendarEvent {
  id: number;
  title: string;
  scheduled_at: string;
  remind_minutes_before: number;
  // 繰り返し種別 ("weekly" もしくは null = 非繰り返し)。編集モーダルの初期値判定に使う。
  recurrence_kind: string | null;
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
  id: number;
  title: string;
  scheduled_at: string;
  event_type: string;
  // dismiss 比較用の安定キー (非繰り返し: "<id>" / 週次: "<id>_YYYY-MM-DD")
  source_ref: string;
}

// アプリ全体の設定値（DB の mira_settings テーブルと対応）
//
// Loop 9 R2-M-20: `remind_minutes_before_default` も DB ベースに統合済み。
// バックエンド `get_settings` がこのフィールドを返すようになったため、フロント側も
// localStorage キャッシュを撤去して MiraSettings から直接参照する
// (CalendarPage / SettingsPage は `settings.get().remind_minutes_before_default` を見る)。
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
  view_hour_start: number;
  view_hour_end: number;
  remind_minutes_before_default: number;
}

// リマインダー発火時のイベントデータ（ポーリングで取得）
export interface ReminderEvent {
  id: number;
  title: string;
  scheduled_at: string;
  event_type: string;
  minutes_until: number;
}

// スナップショット集計データ (annual/quarterly レビュー用)
export interface SnapshotSummary {
  key: string;
  label: string;
  period_start: string;
  period_end: string;
  event_count: number;
  memo_day_count: number;
  memo_char_total: number;
}

// ナビゲーションタブの識別子
export type TabId = "home" | "calendar" | "settings" | "debug";
