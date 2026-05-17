// Tauri invoke のラッパー層。
// バックエンド (src-tauri/src/commands/*) と TypeScript 側の型/引数名を結ぶ単一窓口で、
// invoke() の引数キーは Rust の関数引数名（自動で camelCase 変換される）に合わせる必要がある。
import { invoke } from "@tauri-apps/api/core";
import type {
  WeekLaneData,
  DayFocusData,
  MonthData,
  StartupInfo,
  MiraSettings,
  ReminderEvent,
  ScheduleNotification,
  SnapshotSummary,
} from "../state/types";

// 起動情報（STELLA 接続・予定通知・レビュー誘導）を一括取得する
export async function getStartupInfo(): Promise<StartupInfo> {
  return invoke("get_startup_info");
}

// pending 通知だけを再取得するタスク (予定追加/削除後)
export async function refreshNotifications(): Promise<ScheduleNotification[]> {
  return invoke("get_pending_notifications");
}

// 起動通知を恒久的に dismiss する (source_ref ベース)
export async function dismissNotification(sourceRef: string): Promise<void> {
  return invoke("dismiss_notification", { sourceRef });
}

// レビューキー (snapshot_* / annual_*) を既読にする
export async function markReviewSeen(key: string): Promise<void> {
  return invoke("mark_review_seen", { key });
}

// スナップショット/年間レビューの集計を取得する
export async function getSnapshotSummary(key: string): Promise<SnapshotSummary> {
  return invoke("get_snapshot_summary", { key });
}

// 指定週のタイムラインデータを取得する
export async function getWeekLaneData(weekStart: string): Promise<WeekLaneData> {
  return invoke("get_week_lane_data", { weekStart });
}

// 指定日の詳細データ（訪問・写真・メモ・マーカー）を取得する
export async function getDayFocusData(date: string): Promise<DayFocusData> {
  return invoke("get_day_focus_data", { date });
}

// 指定日のメモを保存する（バックエンドで1000文字に切り詰め）
export async function saveDayMemo(date: string, memo: string): Promise<void> {
  return invoke("save_day_memo", { date, memo });
}

// カレンダー描画用の月別データ（アクティブ日・予定一覧）を取得する
export async function getMonthData(year: number, month: number): Promise<MonthData> {
  return invoke("get_month_data", { year, month });
}

// 現在の設定値を DB から取得する
export async function getSettings(): Promise<MiraSettings> {
  return invoke("get_settings");
}

// 設定値を1つ更新する（mira_settings テーブルへ upsert）
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

// view_hour_start と view_hour_end を原子的に更新する (順序依存エラーを防ぐ)
export async function setViewHourRange(start: number, end: number): Promise<void> {
  return invoke("set_view_hour_range", { start, end });
}

// 発火すべきリマインダーを確認する
export async function checkDueReminders(): Promise<ReminderEvent[]> {
  return invoke("check_due_reminders");
}

// StellaRecord に Mira をサードパーティアプリとして登録する
export async function registerToStellarecord(): Promise<string> {
  return invoke("register_to_stellarecord");
}

// StellaRecordからMiraを登録解除する
export async function unregisterFromStellarecord(): Promise<string> {
  return invoke("unregister_from_stellarecord");
}

// 手動マーカーを追加してIDを返す
export async function addManualMarker(
  date: string,
  start: number,
  end: number,
  color: string,
): Promise<number> {
  return invoke("add_manual_marker", { date, start, end, color });
}

// 指定 ID の手動マーカーを削除する
export async function removeManualMarker(id: number): Promise<void> {
  return invoke("remove_manual_marker", { id });
}

// 予定イベントを追加し、ID を返す
export async function addEvent(
  title: string,
  scheduledAt: string,
  remindMinutesBefore: number,
  isRecurring = false,
  recurrenceKind: string | null = null,
): Promise<number> {
  return invoke("add_event", {
    title,
    scheduledAt,
    remindMinutesBefore,
    isRecurring,
    recurrenceKind,
  });
}

// 指定 ID の予定イベントを削除する
export async function removeEvent(id: number): Promise<void> {
  return invoke("remove_event", { id });
}

// 既存予定イベントを編集する (タイトル / 日時 / 繰り返し / 通知タイミング)
export async function updateCalendarEvent(
  id: number,
  title: string,
  scheduledAt: string,
  recurrenceKind: "none" | "weekly",
  remindMinutesBefore: number,
): Promise<void> {
  return invoke("update_calendar_event", {
    id,
    title,
    scheduledAt,
    recurrenceKind,
    remindMinutesBefore,
  });
}
