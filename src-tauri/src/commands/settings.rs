//! アプリ全体設定の Tauri コマンド群。`mira_settings` テーブル (key/value 形式) を介して
//! フォント / 表示 / メモ上限 / リマインダー音声等の設定を読み書きする。
//! お気に入りユーザー (`mira_favorite_users`) の CRUD も同モジュールで扱う。

use serde::Serialize;
use tauri::State;

use crate::commands::REMIND_MIN_MAX;
use crate::db::DbState;

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
}

/// お気に入り登録されたユーザー情報
#[derive(Serialize)]
pub struct FavoriteUser {
    pub user_id: String,
    pub display_name: String,
    pub nickname: Option<String>,
    pub line_color: Option<String>,
    pub note: Option<String>,
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

    Ok(MiraSettings {
        font_family: get("font_family"),
        font_scope: get("font_scope"),
        memo_max_length: get("memo_max_length").parse().unwrap_or(1000),
        transition_enabled: get("transition_enabled") == "1",
        snapshot_enabled: get("snapshot_enabled") == "1",
        onboarding_completed: get("onboarding_completed") == "1",
        voicevox_enabled: get("voicevox_enabled") == "1",
        voice_character: get("voice_character"),
        reminder_sound_enabled: get("reminder_sound_enabled") == "1",
        view_hour_start: get("view_hour_start").parse().unwrap_or(0),
        view_hour_end: get("view_hour_end").parse().unwrap_or(24),
    })
}

/// 任意の設定キーに値を upsert する。bool は呼出側で "1"/"0" 文字列に揃える前提。
#[tauri::command]
pub fn set_setting(state: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;

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

    mira.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// `view_hour_start` / `view_hour_end` を一度のトランザクションで原子的に更新する
///
/// `set_setting` を 1 キーずつ呼ぶと、片方を更新した直後に
/// 一時的に start >= end になり 2 回目のリクエストがエラーになる詰まりが起きる。
/// このコマンドは両値を 1 トランザクションで書き換え、その内部一貫性を保証する。
#[tauri::command]
pub fn set_view_hour_range(
    state: State<'_, DbState>,
    start: u32,
    end: u32,
) -> Result<(), String> {
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
    let tx = mira
        .transaction()
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value) VALUES ('view_hour_start', ?1)",
        [start.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value) VALUES ('view_hour_end', ?1)",
        [end.to_string()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// お気に入りユーザー一覧をSTELLAの表示名付きで取得する
#[tauri::command]
pub fn get_favorite_users(state: State<'_, DbState>) -> Result<Vec<FavoriteUser>, String> {
    // デッドロック回避のためロック順を stella → mira に統一
    let stella_guard = crate::db::lock_stella(&state)?;
    let mira = crate::db::lock_mira(&state)?;

    let mut stmt = mira
        .prepare("SELECT user_id, nickname, line_color, note FROM mira_favorite_users ORDER BY added_at")
        .map_err(|e| e.to_string())?;

    let favorites: Vec<FavoriteUser> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .filter_map(std::result::Result::ok)
        .map(|(user_id, nickname, line_color, note)| {
            let display_name = stella_guard
                .as_ref()
                .and_then(|s| {
                    s.query_row(
                        "SELECT display_name FROM players WHERE user_id = ?1",
                        [&user_id],
                        |row| row.get(0),
                    )
                    .ok()
                })
                .unwrap_or_else(|| user_id.clone());

            FavoriteUser {
                user_id,
                display_name,
                nickname,
                line_color,
                note,
            }
        })
        .collect();

    Ok(favorites)
}

/// お気に入りユーザーを upsert する (INSERT OR REPLACE のため `nickname/line_color/note` も上書き)
#[tauri::command]
pub fn add_favorite_user(
    state: State<'_, DbState>,
    user_id: String,
    nickname: Option<String>,
    line_color: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    mira.execute(
        "INSERT OR REPLACE INTO mira_favorite_users (user_id, nickname, line_color, note, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![user_id, nickname, line_color, note, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 指定 `user_id` をお気に入りから削除する (該当なしでも成功扱い)
#[tauri::command]
pub fn remove_favorite_user(state: State<'_, DbState>, user_id: String) -> Result<(), String> {
    let mira = crate::db::lock_mira(&state)?;
    mira.execute(
        "DELETE FROM mira_favorite_users WHERE user_id = ?1",
        [&user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}