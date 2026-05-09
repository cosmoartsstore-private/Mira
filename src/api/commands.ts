import { invoke } from "@tauri-apps/api/core";
import type {
  WeekLaneData,
  DayFocusData,
  MonthData,
  StartupInfo,
  MiraSettings,
  ReminderEvent,
} from "../state/types";

// アプリ起動情報を取得する
export async function getStartupInfo(): Promise<StartupInfo> {
  return invoke("get_startup_info");
}

// 指定週のタイムラインデータを取得する
export async function getWeekLaneData(weekStart: string): Promise<WeekLaneData> {
  return invoke("get_week_lane_data", { weekStart });
}

// 指定日のフォーカスデータを取得する
export async function getDayFocusData(date: string): Promise<DayFocusData> {
  return invoke("get_day_focus_data", { date });
}

// 指定日のメモを保存する
export async function saveDayMemo(date: string, memo: string): Promise<void> {
  return invoke("save_day_memo", { date, memo });
}

// 指定月のカレンダーデータを取得する
export async function getMonthData(year: number, month: number): Promise<MonthData> {
  return invoke("get_month_data", { year, month });
}

// 現在の設定値を取得する
export async function getSettings(): Promise<MiraSettings> {
  return invoke("get_settings");
}

// 設定値を更新する
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

// 発火すべきリマインダーを確認する
export async function checkDueReminders(): Promise<ReminderEvent[]> {
  return invoke("check_due_reminders");
}

// STELLARecord DBの接続可否を確認する
export async function checkStellarecordAvailable(): Promise<boolean> {
  return invoke("check_stellarecord_available");
}

// STELLARecordにMiraを登録する
export async function registerToStellarecord(): Promise<string> {
  return invoke("register_to_stellarecord");
}

// 手動マーカーを追加してIDを返す
export async function addManualMarker(
  date: string,
  start: number,
  end: number,
  color: string
): Promise<number> {
  return invoke("add_manual_marker", { date, start, end, color });
}

// 手動マーカーを削除する
export async function removeManualMarker(id: number): Promise<void> {
  return invoke("remove_manual_marker", { id });
}

// イベントを追加してIDを返す
export async function addEvent(
  title: string,
  scheduledAt: string,
  remindMinutesBefore: number
): Promise<number> {
  return invoke("add_event", { title, scheduledAt, remindMinutesBefore });
}

// イベントを削除する
export async function removeEvent(id: number): Promise<void> {
  return invoke("remove_event", { id });
}
