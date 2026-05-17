//! アプリ全体設定の Tauri コマンド群。`mira_settings` テーブル (key/value 形式) を介して
//! フォント / 表示 / メモ上限 / リマインダー音声等の設定を読み書きする。

use serde::Serialize;
use tauri::State;

use crate::commands::{DEFAULT_MEMO_MAX_LENGTH, REMIND_MIN_MAX};
use crate::db::DbState;
use crate::utils::logging;

/// アプリ全体の設定値。トグル系設定 (`transition` / `snapshot` / `onboarding` / `voicevox` / `reminder_sound`)
/// で bool が複数並ぶのは UI 設定の性質上自然で、列挙型化はかえって扱いにくい。
#[allow(clippy::struct_excessive_bools)]
#[derive(Serialize)]
pub struct MiraSettings {
    pub font_family: String,
    pub font_scope: String,
    pub memo_max_length: u32,
    pub transition_enabled: bool,
    pub snapshot_enabled: bool,
    pub onboarding_completed: bool,
    pub voicevox_enabled: bool,
    pub voice_character: String,
    pub reminder_sound_enabled: bool,
    pub view_hour_start: u32,
    pub view_hour_end: u32,
    /// L2 R2-20: 旧 Loop 1 で localStorage 経由だった既定リマインド分数を DB ベースに統合。
    /// フロント側型定義 (`src/state/types.ts`) はまだ追従していないため、戻り JSON に
    /// 追加するだけ (TS は余分なフィールドを無視する)。フロント統合は別エージェント担当。
    pub remind_minutes_before_default: i64,
}

/// `set_setting` で受け入れる既知キーの一覧。
/// allowlist 化することでタイポしたキーや未定義の予約キーが DB に溜まるのを防ぐ。
/// 新規キーを追加するときはここと [`get_settings`] / [`crate::db::migrations`] の defaults を揃える。
///
/// 注意: `last_snapshot_seen` / `last_annual_seen` は `mark_review_seen` 専用の
/// 内部キーで、汎用 `set_setting` 経由では更新させない (誤って任意期キーが書込まれるのを防ぐ)。
const ALLOWED_SETTING_KEYS: &[&str] = &[
    "font_family",
    "font_scope",
    "memo_max_length",
    "transition_enabled",
    "snapshot_enabled",
    "onboarding_completed",
    "voicevox_enabled",
    "voice_character",
    "reminder_sound_enabled",
    "view_hour_start",
    "view_hour_end",
    "remind_minutes_before_default",
];

/// 真偽値として解釈する設定キー (値域 `"0"` / `"1"` のみ許容)
const BOOL_SETTING_KEYS: &[&str] = &[
    "transition_enabled",
    "snapshot_enabled",
    "onboarding_completed",
    "voicevox_enabled",
    "reminder_sound_enabled",
];

/// L4 R4-Err-10: 数値系設定値が parse 失敗した場合 (DB が直接書き換えられた / 旧フォーマット混入)、
///   silent に fallback すると「設定したはずの値が反映されない」が無音で起きる。
///   parse 結果の取り出しを集約し、失敗時のみ eprintln を出す (空文字は未設定なので無視)。
fn parse_or_warn<T: std::str::FromStr>(key: &str, raw: &str, fallback: T) -> T {
    if raw.is_empty() {
        return fallback;
    }
    if let Ok(v) = raw.parse::<T>() {
        v
    } else {
        // L6 Log-7: 設定値はユーザー入力なので redact (key は内部 allowlist のため生のまま OK)
        logging::log_warn(
            "settings",
            &format!(
                "invalid value for {key}: {} (fallback 採用)",
                logging::redact(raw)
            ),
        );
        fallback
    }
}

/// `mira_settings` から `MiraSettings` 構造体を組み立てて返す。
/// 「1" → true、それ以外 → false」のルールで真偽値を解釈。
/// 値が無いキーは `unwrap_or_default` で空文字扱いとなり、bool は OFF として処理される。
#[tauri::command]
pub fn get_settings(state: State<'_, DbState>) -> Result<MiraSettings, String> {
    let mira = crate::db::lock_mira(&state)?;

    // 単純な「キーで value を引いて文字列で返す」クロージャ。失敗時は空文字
    let get = |key: &str| -> String {
        mira.query_row(
            "SELECT value FROM mira_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .unwrap_or_default()
    };

    let memo_raw = get("memo_max_length");
    let view_start_raw = get("view_hour_start");
    let view_end_raw = get("view_hour_end");
    let remind_default_raw = get("remind_minutes_before_default");

    Ok(MiraSettings {
        font_family: get("font_family"),
        font_scope: get("font_scope"),
        memo_max_length: parse_or_warn(
            "memo_max_length",
            &memo_raw,
            u32::try_from(DEFAULT_MEMO_MAX_LENGTH).unwrap_or(1000),
        ),
        transition_enabled: get("transition_enabled") == "1",
        snapshot_enabled: get("snapshot_enabled") == "1",
        onboarding_completed: get("onboarding_completed") == "1",
        voicevox_enabled: get("voicevox_enabled") == "1",
        voice_character: get("voice_character"),
        reminder_sound_enabled: get("reminder_sound_enabled") == "1",
        view_hour_start: parse_or_warn("view_hour_start", &view_start_raw, 0),
        view_hour_end: parse_or_warn("view_hour_end", &view_end_raw, 24),
        // L2 R2-20: 未設定時は 10 分 (calendar::add_event のデフォルト感覚に合わせる)
        remind_minutes_before_default: parse_or_warn(
            "remind_minutes_before_default",
            &remind_default_raw,
            10,
        ),
    })
}

/// 任意の設定キーに値を upsert する。bool は呼出側で "1"/"0" 文字列に揃える前提。
/// `ALLOWED_SETTING_KEYS` 外のキーは弾き、bool キーは値域も検証する。
#[tauri::command]
pub fn set_setting(state: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;

    if !ALLOWED_SETTING_KEYS.contains(&key.as_str()) {
        return Err(format!("unknown setting key: {key}"));
    }

    // bool キーは "0" / "1" のみ許容
    if BOOL_SETTING_KEYS.contains(&key.as_str()) && value != "0" && value != "1" {
        return Err(format!("invalid bool value for {key}: {value}"));
    }

    // view_hour_start / view_hour_end は範囲と前後関係を検証する
    if key == "view_hour_start" || key == "view_hour_end" {
        let parsed: u32 = value
            .parse()
            .map_err(|_| format!("invalid {key} value: {value}"))?;
        // detect_activity_range が 30 まで返すため上限は 30 に合わせる
        if parsed > 30 {
            return Err(format!("{key} must be in 0..=30"));
        }
        // 反対側の値と比較し start < end を保証する
        let other_key = if key == "view_hour_start" {
            "view_hour_end"
        } else {
            "view_hour_start"
        };
        let other: u32 = mira
            .query_row(
                "SELECT value FROM mira_settings WHERE key = ?1",
                [other_key],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or_else(|| if other_key == "view_hour_end" { 24 } else { 0 });

        let (start, end) = if key == "view_hour_start" {
            (parsed, other)
        } else {
            (other, parsed)
        };
        if start >= end {
            return Err(format!(
                "view_hour_start ({start}) must be less than view_hour_end ({end})"
            ));
        }
    }

    // memo_max_length は 1..=100000 に制限 (極端値・負値・非数を拒否)
    if key == "memo_max_length" {
        let parsed: u32 = value
            .parse()
            .map_err(|_| format!("invalid {key} value: {value}"))?;
        if !(1..=100_000).contains(&parsed) {
            return Err(format!("{key} must be in 1..=100000, got {parsed}"));
        }
    }

    // remind_minutes_before 設定キー (将来用) の安全側検証
    if key == "remind_minutes_before_default" {
        let parsed: i64 = value
            .parse()
            .map_err(|_| format!("invalid {key} value: {value}"))?;
        if !(0..=REMIND_MIN_MAX).contains(&parsed) {
            return Err(format!(
                "{key} must be in 0..={REMIND_MIN_MAX}, got {parsed}"
            ));
        }
    }

    // L2 R2-6: value_type を bool キーは 'bool' / それ以外は 'text' で記録する。
    //   既存 INSERT OR REPLACE は (key, value) しか書かなかったが、
    //   value_type 列追加後は明示的にセットしないと REPLACE で 'text' デフォルトに戻ってしまう。
    //   将来 int 系キーを追加する場合は INT_SETTING_KEYS を導入してここで分岐する。
    let value_type = if BOOL_SETTING_KEYS.contains(&key.as_str()) {
        "bool"
    } else {
        "text"
    };
    mira.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value, value_type) VALUES (?1, ?2, ?3)",
        rusqlite::params![key, value, value_type],
    )
    .map_err(|e| {
        logging::log_error(
            "settings",
            &format!("set_setting INSERT 失敗 (key={key}): {e}"),
        );
        "設定の保存に失敗しました".to_string()
    })?;
    Ok(())
}

/// `view_hour_start` / `view_hour_end` を一度のトランザクションで原子的に更新する
///
/// `set_setting` を 1 キーずつ呼ぶと、片方を更新した直後に
/// 一時的に start >= end になり 2 回目のリクエストがエラーになる詰まりが起きる。
/// このコマンドは両値を 1 トランザクションで書き換え、その内部一貫性を保証する。
#[tauri::command]
pub fn set_view_hour_range(state: State<'_, DbState>, start: u32, end: u32) -> Result<(), String> {
    if start > 30 || end > 30 {
        return Err(format!(
            "view_hour values must be in 0..=30, got start={start}, end={end}"
        ));
    }
    if start >= end {
        return Err(format!(
            "view_hour_start ({start}) must be less than view_hour_end ({end})"
        ));
    }

    let mut mira = crate::db::lock_mira(&state)?;
    let tx = mira.transaction().map_err(|e| {
        logging::log_error(
            "settings",
            &format!("view_hour_range transaction 開始失敗: {e}"),
        );
        "表示時間帯の保存に失敗しました".to_string()
    })?;
    tx.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value) VALUES ('view_hour_start', ?1)",
        [start.to_string()],
    )
    .map_err(|e| {
        logging::log_error("settings", &format!("view_hour_start INSERT 失敗: {e}"));
        "表示時間帯の保存に失敗しました".to_string()
    })?;
    tx.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value) VALUES ('view_hour_end', ?1)",
        [end.to_string()],
    )
    .map_err(|e| {
        logging::log_error("settings", &format!("view_hour_end INSERT 失敗: {e}"));
        "表示時間帯の保存に失敗しました".to_string()
    })?;
    tx.commit().map_err(|e| {
        logging::log_error("settings", &format!("view_hour_range commit 失敗: {e}"));
        "表示時間帯の保存に失敗しました".to_string()
    })?;
    Ok(())
}
