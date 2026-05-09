use serde::Serialize;
use tauri::State;

use crate::db::DbState;

/// アプリ全体の設定値
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

/// 全設定値をDBから読み込んで返す
#[tauri::command]
pub fn get_settings(state: State<'_, DbState>) -> Result<MiraSettings, String> {
    let mira = state.mira.lock().unwrap();

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
    })
}

/// 指定キーの設定値を保存(upsert)する
#[tauri::command]
pub fn set_setting(state: State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    let mira = state.mira.lock().unwrap();
    mira.execute(
        "INSERT OR REPLACE INTO mira_settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// お気に入りユーザー一覧をSTELLAの表示名付きで取得する
#[tauri::command]
pub fn get_favorite_users(state: State<'_, DbState>) -> Result<Vec<FavoriteUser>, String> {
    let mira = state.mira.lock().unwrap();
    let stella_guard = state.stella.lock().unwrap();

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
        .filter_map(|r| r.ok())
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

/// ユーザーをお気に入りに追加・更新する
#[tauri::command]
pub fn add_favorite_user(
    state: State<'_, DbState>,
    user_id: String,
    nickname: Option<String>,
    line_color: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    let mira = state.mira.lock().unwrap();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    mira.execute(
        "INSERT OR REPLACE INTO mira_favorite_users (user_id, nickname, line_color, note, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![user_id, nickname, line_color, note, now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 指定ユーザーをお気に入りから削除する
#[tauri::command]
pub fn remove_favorite_user(state: State<'_, DbState>, user_id: String) -> Result<(), String> {
    let mira = state.mira.lock().unwrap();
    mira.execute(
        "DELETE FROM mira_favorite_users WHERE user_id = ?1",
        [&user_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
