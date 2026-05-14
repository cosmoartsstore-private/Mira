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
} from "../state/types";

// 起動情報（STELLA 接続・予定通知・レビュー誘導）を一括取得する
export async function getStartupInfo(): Promise<StartupInfo> {
  return invoke("get_startup_info");
}

// 指定週 (Sun始まり, YYYY-MM-DD) から7日分のレーンデータを取得する
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

// 発火時刻に達した未通知リマインダーを取得し、同時に通知済みに更新する
export async function checkDueReminders(): Promise<ReminderEvent[]> {
  return invoke("check_due_reminders");
}

// STELLARecord DB ファイルの存在を確認する（未インストール検出用）
export async function checkStellarecordAvailable(): Promise<boolean> {
  return invoke("check_stellarecord_available");
}

// STELLARecord に Mira を fastparty アプリとして登録する
export async function registerToStellarecord(): Promise<string> {
  return invoke("register_to_stellarecord");
}

// 手動マーカーを追加し、付番された ID を返す。
// start/end は UTF-16 コードユニット位置 (frontend の getSelectionOffsets 由来)。
export async function addManualMarker(
  date: string,
  start: number,
  end: number,
  color: string
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
  remindMinutesBefore: number
): Promise<number> {
  return invoke("add_event", { title, scheduledAt, remindMinutesBefore });
}

// 指定 ID の予定イベントを削除する
export async function removeEvent(id: number): Promise<void> {
  return invoke("remove_event", { id });
}
