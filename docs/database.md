# データベース仕様

Mira は **2 つの SQLite データベース**を扱う。

| DB                  | アクセス     | 役割                                                                 |
| ------------------- | ------------ | -------------------------------------------------------------------- |
| **Mira DB**         | 読み書き     | メモ・予定・ワールド色・設定など Mira 固有データ                     |
| **StellaRecord DB** | 読み取り専用 | VRChat 活動ログ (訪問・出会い・写真)。STELLA RECORD が生成・所有する |

StellaRecord DB のスキーマは Mira の管理対象外であり、Mira は **ビュー / テーブルを読むだけ**で書き込まない。本書は主に Mira DB を対象とする。

---

## Mira DB スキーマ

DDL は [`src-tauri/src/db/migrations.rs`](../src-tauri/src/db/migrations.rs) の `run()` に集約されている。
全テーブルが `CREATE TABLE IF NOT EXISTS` で冪等に作成され、列の追加・削除は `pragma_table_info` で
存在確認してから `ALTER` する防御的マイグレーションで行う。

### テーブル一覧

#### `mira_journal_entries` — 日次メモ

| カラム         | 型       | 制約        | 説明                     |
| -------------- | -------- | ----------- | ------------------------ |
| `date`         | TEXT     | PRIMARY KEY | `YYYY-MM-DD`             |
| `user_memo`    | TEXT     |             | ユーザー記入の本文       |
| `data_version` | TEXT     |             | 保存時のデータバージョン |
| `created_at`   | DATETIME | NOT NULL    | 作成時刻                 |
| `updated_at`   | DATETIME | NOT NULL    | 更新時刻                 |

#### `mira_scheduled_events` — 予定イベント

| カラム                  | 型       | 制約 / 既定                        | 説明                                            |
| ----------------------- | -------- | ---------------------------------- | ----------------------------------------------- |
| `id`                    | INTEGER  | PK AUTOINCREMENT                   |                                                 |
| `event_type`            | TEXT     | NOT NULL, CHECK IN ('reservation') | 種別                                            |
| `title`                 | TEXT     | NOT NULL                           | 表示名                                          |
| `scheduled_at`          | DATETIME | NOT NULL                           | 予定日時                                        |
| `source`                | TEXT     | NOT NULL, CHECK IN ('user')        | 由来                                            |
| `source_ref`            | TEXT     |                                    | 汎用参照キー                                    |
| `notify_on_launch`      | BOOLEAN  | NOT NULL DEFAULT 1, CHECK IN (0,1) | 起動時通知の有無                                |
| `is_recurring`          | BOOLEAN  | NOT NULL DEFAULT 0, CHECK IN (0,1) | 繰り返し有無                                    |
| `created_at`            | DATETIME | NOT NULL                           | 作成時刻                                        |
| `remind_minutes_before` | INTEGER  | NOT NULL DEFAULT 10                | 何分前に通知するか (上限 `REMIND_MIN_MAX`=1440) |
| `reminded`              | INTEGER  | NOT NULL DEFAULT 0                 | 通知済みフラグ                                  |
| `recurrence_kind`       | TEXT     |                                    | 繰り返し種別                                    |
| `last_fired_at`         | TEXT     |                                    | 最後に発火した時刻                              |

#### `mira_world_colors` — ワールド色キャッシュ

| カラム       | 型      | 制約                               | 説明                                             |
| ------------ | ------- | ---------------------------------- | ------------------------------------------------ |
| `world_name` | TEXT    | PRIMARY KEY                        | 主キー (R2-M-26: `world_id` から変更)            |
| `color_hex`  | TEXT    | NOT NULL                           | `#rrggbb`。`logic::world_color` が決定論的に生成 |
| `is_custom`  | BOOLEAN | NOT NULL DEFAULT 0, CHECK IN (0,1) | ユーザー手動変更フラグ (将来 UI 用予約)          |

#### `mira_manual_markers` — メモ手動マーカー

| カラム      | 型      | 制約                          | 説明                |
| ----------- | ------- | ----------------------------- | ------------------- |
| `id`        | INTEGER | PK AUTOINCREMENT              |                     |
| `date`      | TEXT    | NOT NULL                      | 対象日 `YYYY-MM-DD` |
| `start_pos` | INTEGER | NOT NULL                      | UTF-16 開始位置     |
| `end_pos`   | INTEGER | NOT NULL                      | UTF-16 終了位置     |
| `color`     | TEXT    | NOT NULL DEFAULT 'red'        | マーカー色          |
|             |         | CHECK (`start_pos < end_pos`) | 空範囲を禁止        |

> 位置は **UTF-16 コードユニット**で保存する。フロント (JS) の文字列インデックスと
> 整合させるためで、`logic::marker` も同じ単位でマッチ位置を返す。

#### `mira_settings` — 設定 (Key-Value)

| カラム  | 型   | 制約        |
| ------- | ---- | ----------- |
| `key`   | TEXT | PRIMARY KEY |
| `value` | TEXT | NOT NULL    |

既知キーは `migrations.rs` の `defaults` で `INSERT OR IGNORE` 初期化される
(`font_family`, `font_scope`, `memo_max_length`, `transition_enabled`, `snapshot_enabled`,
`last_snapshot_seen`, `last_annual_seen`, `onboarding_completed`, `view_hour_start`,
`view_hour_end`, `voicevox_enabled`, `voice_character`, `reminder_sound_enabled`)。

#### `mira_dismissed_events` — 通知 dismiss 記録

| カラム         | 型       | 制約        | 説明                       |
| -------------- | -------- | ----------- | -------------------------- |
| `source_ref`   | TEXT     | PRIMARY KEY | dismiss した通知の参照キー |
| `dismissed_at` | DATETIME | NOT NULL    | dismiss 時刻               |

### インデックス

| インデックス                             | 対象                                  | 目的                     |
| ---------------------------------------- | ------------------------------------- | ------------------------ |
| `idx_mira_scheduled_events_scheduled_at` | `mira_scheduled_events(scheduled_at)` | 予定の範囲検索           |
| `idx_mira_manual_markers_date`           | `mira_manual_markers(date)`           | 日付別マーカー取得       |
| `idx_mira_dismissed_events_dismissed_at` | `mira_dismissed_events(dismissed_at)` | dismiss 履歴の時系列検索 |

---

## マイグレーション方針

1. `CREATE TABLE IF NOT EXISTS` で現行スキーマを冪等に作成
2. 廃止テーブル / 廃止カラムを `DROP IF EXISTS` パターンで撤去
3. 後付けカラムを `column_exists` 確認後に個別 `ALTER` で追加
   (`ALTER TABLE` は SQLite で DDL として自動コミットされるため、明示トランザクションでは囲まない)
4. 性能向上のための `INDEX` を `IF NOT EXISTS` で作成
5. `mira_settings` の既知キーを `INSERT OR IGNORE` で初期化

`mira_world_colors` の主キーを `world_id` → `world_name` に切り替えた際は、旧スキーマを検出して
テーブルを作り直す (色は使い込めば再生成されるためデータ移行不要)。

---

## StellaRecord DB から読むオブジェクト

`logic` 層および各コマンドが参照する主な読み取り対象:

| オブジェクト    | 用途                                                 |
| --------------- | ---------------------------------------------------- |
| `visits`        | `join_time` の分布から週レーンの表示時間帯を自動推定 |
| `visit_summary` | 指定日の訪問ワールド一覧 (めもきっと・レーン描画)    |
| `with_users`    | 同席ユーザー (`is_self=0` で自分を除外)              |
| `find_users`    | `vrchat_id → account_name` 解決                      |

> R2-M-26: `visit_summary` ビューは `world_id` を保持していないため、Mira 側の色キャッシュは
> `world_name` をキーにしている。
