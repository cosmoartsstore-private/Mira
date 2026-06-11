# Specification

> Mira の機能仕様書。アーキテクチャ・モジュール構成・IPC API・データフロー・並行性モデル・性能特性をリファレンス形式で記述する。
>
> **対象読者**: Mira の機能挙動・モジュール構成・IPC コマンドを把握したい開発者および技術評価者。
> **関連ドキュメント**: DB スキーマの詳細は [database.md](database.md) を、技術選定の経緯は [tech-stack.md](tech-stack.md) を参照。

## Table of Contents

- [Overview](#overview)
- [Glossary](#glossary)
- [Architecture](#architecture)
- [Module Organization](#module-organization)
- [Feature Specifications](#feature-specifications)
  - [Weekly Timeline](#weekly-timeline)
  - [Day Focus](#day-focus)
  - [Daily Memo and Markers](#daily-memo-and-markers)
  - [Memokitto](#memokitto)
  - [Cork Board Photos](#cork-board-photos)
  - [Calendar and Events](#calendar-and-events)
  - [Reminder](#reminder)
  - [Snapshot](#snapshot)
  - [Settings](#settings)
- [IPC Reference](#ipc-reference)
- [Data Flow](#data-flow)
- [State Management](#state-management)
- [Concurrency Model](#concurrency-model)
- [StellaRecord Integration](#stellarecord-integration)
- [Security Model](#security-model)
- [Persistence](#persistence)
- [Known Limitations](#known-limitations)

---

## Overview

Mira は VRChat の活動ログを「振り返り」のために再構成する Windows デスクトップアプリケーションである。生ログ自体を解析することはなく、姉妹アプリ StellaRecord が正規化した SQLite データベースを読み取り専用で参照する。

### Goals

- VRChat の訪問履歴・出会い・写真を週単位 / 日単位で可視化する
- 日次の手書きメモ機能を提供し、本文中のワールド名・ユーザー名を自動マーカーでハイライトする
- 季節ごとの四半期サマリーと年間レビューでユーザーの活動量を振り返る
- ユーザー登録イベントの通知 (起動時カード + ピン + リマインダー) を提供する
- ローカル完結で動作し、外部サーバ依存を持たない

### Non-Goals

- VRChat ログそのものの解析 (StellaRecord に委譲)
- StellaRecord DB への書き込み (apps テーブルへの自己登録のみ例外)
- マルチユーザー・サーバ運用
- macOS / Linux 対応

---

## Glossary

| 用語                 | 定義                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| **Mira DB**          | Mira 専用 SQLite (`Data/db/mira.db`)。メモ・予定・マーカー・色を格納 |
| **StellaRecord DB**  | StellaRecord が書き込む読み取り対象の SQLite (`stellarecord.db`)     |
| **訪問 (visit)**     | ワールドインスタンスへの 1 回の入退室。StellaRecord 側で記録         |
| **レーン (lane)**    | 1 日の縦時間軸 + 訪問ブロックの集合                                  |
| **フォーカスビュー** | 1 日を選んだときに切り替わる詳細画面                                 |
| **めもきっと**       | その日に観測した名前から動的に生成されるロール紙風ステッカー         |
| **手動マーカー**     | ユーザーが選択範囲に色付き下線を引く機能 (4 色)                      |
| **スナップショット** | 四半期 (Q1=4-6, Q2=7-9, Q3=10-12, Q4=1-3) のレビュー                 |
| **年間レビュー**     | 1 年間 (1/1〜12/31) のレビュー                                       |
| **pending_review**   | 起動時に届く未読レビューキー (`snapshot_YYYY-Qn` / `annual_YYYY`)    |

---

## Architecture

### Layered View

```
┌──────────────────────────────────────────────────────────────┐
│ Presentation Layer (TypeScript + Vanilla DOM)                │
│  - pages/: ページコンポーネント (home/calendar/settings/debug)│
│  - components/: 共通 UI 部品                                  │
│  - animations/: 演出 (transition / snapshot / summary)        │
├──────────────────────────────────────────────────────────────┤
│ Service Layer                                                │
│  - services/reminder.ts: 30 秒ポーリング + 音声 + トースト    │
├──────────────────────────────────────────────────────────────┤
│ State Layer                                                  │
│  - state/store.ts: Store<T> リアクティブストア (Set<Listener>)│
│  - state/types.ts: 全 IPC ペイロード型                        │
├──────────────────────────────────────────────────────────────┤
│ API Layer                                                    │
│  - api/commands.ts: Tauri invoke ラッパー (21 コマンド)       │
├──────────────────────────────────────────────────────────────┤
│ IPC Boundary (Tauri 2.11)                                    │
├──────────────────────────────────────────────────────────────┤
│ Application Layer (Rust)                                     │
│  - commands/: IPC ハンドラ (7 モジュール = 21 コマンド)       │
│  - logic/: ビジネスロジック (色生成・マーカー・めもきっと)    │
│  - db/: 2 つの DB 接続管理 (Mira + StellaRecord)              │
├──────────────────────────────────────────────────────────────┤
│ Storage Layer                                                │
│  - Mira DB (WAL モード、書込可)                               │
│  - StellaRecord DB (read-only)                                │
│  - Windows Registry                                           │
└──────────────────────────────────────────────────────────────┘
```

### Process Model

Mira は 1 プロセス・最小スレッドで動作する。

| Thread           | Owner                                         | Lifetime         |
| ---------------- | --------------------------------------------- | ---------------- |
| Main thread      | Tauri runtime + IPC handler                   | プロセス全寿命   |
| Reminder polling | `services/reminder.ts` の `setTimeout` ループ | 起動から終了まで |

バックグラウンド解析ワーカーは存在しない (StellaRecord 側で完結)。IPC ハンドラは同期的に DB アクセスして即座に応答する。

---

## Module Organization

### Frontend (`src/`)

```
src/
├── main.ts                エントリポイント (initApp 呼出)
├── app.ts                 起動シーケンス、タブ切替、遷移演出統括
├── api/
│   └── commands.ts        Tauri invoke ラッパー (21 コマンド)
├── state/
│   ├── store.ts           Store<T>、Subscriptions、getMonday()
│   └── types.ts           全 IPC ペイロード型
├── pages/
│   ├── home/HomePage.ts   週レーン + 日次フォーカス (最大ページ)
│   ├── calendar/CalendarPage.ts  月別カレンダー + 予定 CRUD
│   ├── settings/SettingsPage.ts  設定 + クレジット
│   └── debug/DebugPage.ts        DEV ビルド限定パネル
├── components/
│   ├── Navbar.ts                 ナビゲーションバー
│   ├── StartupReminder.ts        起動時通知カード
│   └── SnapshotModal.ts          スナップショット集計モーダル
├── animations/
│   ├── transition.ts             ページ切替スライドカバー
│   ├── snapshot.ts               封筒開封演出
│   └── summary.ts                季節パーティクル演出
├── services/
│   └── reminder.ts               30 秒ポーリング + チャイム + 音声
├── utils/
│   ├── datetime.ts               formatTime / parseHourFraction
│   ├── html.ts                   escapeHtml / errMessage
│   ├── toast.ts                  showToast
│   ├── confirmDialog.ts          confirmDialog
│   └── holidays.ts               日本の祝日テーブル
├── styles/                       14 ファイルの CSS モジュール
└── assets/                       テクスチャ / 通知音 / VOICEVOX / avatar
```

### Backend (`src-tauri/src/`)

```
src-tauri/src/
├── main.rs                 エントリポイント (lib::run を呼ぶだけ)
├── lib.rs                  Tauri 起動と IPC ハンドラ登録
├── commands/
│   ├── mod.rs              REMIND_MIN_MAX 定数のみ
│   ├── startup.rs          起動情報・通知・既読マーク (4 コマンド)
│   ├── journal.rs          週レーン・日次データ・メモ・マーカー (5 コマンド)
│   ├── calendar.rs         月別データ・予定 CRUD (4 コマンド)
│   ├── settings.rs         設定 CRUD (3 コマンド)
│   ├── reminder.rs         期限到来リマインダー取得 (1 コマンド)
│   ├── snapshot.rs         四半期/年間レビュー集計 (1 コマンド)
│   └── stella.rs           StellaRecord 検出・登録 (3 コマンド)
├── db/
│   ├── mod.rs              DbState + lock_mira / lock_stella
│   ├── mira_db.rs          Mira DB オープン (WAL + FK)
│   ├── stella_db.rs        StellaRecord DB 読込専用接続
│   └── migrations.rs       Mira スキーマ DDL + ALTER/DROP 防御マイグレーション
└── logic/
    ├── memokitto.rs        その日に観測した名前のステッカー候補生成
    ├── world_color.rs      world_name から決定論的 HSL 色生成
    ├── marker.rs           本文中のワールド/ユーザー名検出 (Unicode scalar オフセット)
    └── time_range.rs       1 週間ぶんの活動から表示時間帯を自動算出
```

---

## Feature Specifications

### Weekly Timeline

**Purpose**: 1 週間 (月曜始まり) の VRChat 訪問履歴をレーン形式で可視化する。

#### Components

- `HomePage.ts` の週ビュー部
- バックエンド: `commands::journal::get_week_lane_data`
- 色生成: `logic::world_color`
- 表示時間帯算出: `logic::time_range`

#### Behavior

- 起動時は今週 (月曜始まり) を初期表示。`←` / `→` キーで週送り。
- 7 日分の縦レーンを並べ、訪問は絶対配置の色付きブロックで描画する。
- ブロック色は `world_name` から決定論的に生成した HSL 値 (`mira_world_colors` にキャッシュ)。
- 時間軸は `time_range::detect_activity_range` が活動範囲から自動算出 (0〜30 時) し、ユーザー設定 `view_hour_start` / `view_hour_end` で更にキャップする。
- 表示範囲外の訪問は `外 +N件` バッジに集約。
- 予定通知は `notif-pin` として該当時刻に縦配置。
- Shift + マウスホイールでズーム (フォーカス時のみ、6h 基準で 1〜24h)。

### Day Focus

**Purpose**: 1 日を選んだときの詳細パネル (訪問・同席ユーザー・写真・メモ) を表示する。

#### Behavior

- `focusedDate` ストアに日付を set すると、HomePage が focus-mode クラスを付与してパネルを展開する。
- バックエンドは `get_day_focus_data(date)` で 1 リクエストにすべて返す:
  - `visits` (ブロックリスト)
  - `total_duration_min`, `people_count`, `photo_count`
  - `photos` (時刻付き写真リスト)
  - `memo` (ユーザーメモ本文)
  - `memo_markers` (自動検出した世界/人名のスパン)
  - `manual_markers` (ユーザーが付けた色付きマーカー)
  - `memokitto` (めもきっとチップ候補)
- 訪問ブロッククリックで写真が時間帯フィルタされ、同席ユーザー一覧が写真の上に挿入される。

### Daily Memo and Markers

**Purpose**: 1 日 1 メモ。本文中のワールド名・ユーザー名を下線でハイライトする。

#### Components

- `HomePage.ts` の `renderMemoCard`、`renderMarkerText`、`wireMarkerContextMenu`
- バックエンド: `commands::journal::{save_day_memo, add_manual_marker, remove_manual_marker}`
- マーカー検出: `logic::marker`

#### Behavior

- メモ最大長は `mira_settings.memo_max_length` で設定 (デフォルト 1000)。
- 1 秒のデバウンス自動保存 (`memoSaveTimeout`)。日付切替/unmount 時に未保存があれば flush。
- 自動マーカー (`memo_markers`):
  - `marker.rs` が観測済みのワールド/ユーザー名を本文中から検出
  - UTF-8 バイト位置を Unicode scalar (char) 位置に変換して返す。フロントの手動マーカー (`getSelectionOffsets`) と同じ単位に統一されており、絵文字混在時もズレが生じない (L7-MarkerUnit)
- 手動マーカー (`manual_markers`):
  - テキスト選択 → 右クリックで色選択メニュー (4 色: red / blue / green / orange)
  - `mira_manual_markers` に start_pos / end_pos / color として保存
  - 既存マーカー上で右クリックすると「マーカーを消す」項目が出る

### Memokitto

**Purpose**: その日に観測した名前を、ロール紙風ステッカーから 1 クリックでメモに挿入する。

#### Behavior

- バックエンドは `logic::memokitto::build_memokitto` でその日に観測した:
  - 訪問したワールド名
  - 同席ユーザー名
  - メモ本文に既出のものは除外
- フロントは `renderMemokittoTray` でステッカーパレットを描画し、クリックでテキストエリアのカーソル位置に挿入する。

### Cork Board Photos

**Purpose**: VRChat Camera で撮影された写真をコルクボード風に並べる。

#### Behavior

- 最大 7 枚までサムネイル表示、超過分は `+N` ボタンで Lightbox の N 枚目から閲覧。
- 訪問ブロッククリックで時間帯フィルタが効く。
- ファイルパスは Tauri の `convertFileSrc()` で `asset://` URL に変換して描画。

### Calendar and Events

**Purpose**: 月別カレンダーで活動日 / 祝日 / 予定を可視化し、予定を追加・削除する。

#### Components

- `CalendarPage.ts`
- バックエンド: `commands::calendar::{get_month_data, add_event, update_calendar_event, remove_event}`
- 祝日テーブル: `utils::holidays::getJapaneseHolidays`

#### Behavior

- 月曜始まりの 7 列グリッド。日付セルに以下を表示:
  - 活動日: 緑のドット
  - 祝日: 名称ラベル + クラス
  - 予定: タグ (最大 3 件、超過分は `+N 件` の集約タグ)
- 日付クリックで:
  - 活動日かつ予定なし → HomePage のフォーカスビューに遷移
  - それ以外 → 予定追加ポップアップ
- 予定は `mira_scheduled_events` に保存。リマインダー秒数は 5/10/15/20/30/60 分前から選択。
- 「毎週繰り返す」チェックで `is_recurring=1` / `recurrence_kind='weekly'` として保存。
- 既存予定は `update_calendar_event(id, title, scheduled_at, recurrence_kind, remind_minutes_before)` で編集可能。`scheduled_at` を変更した場合のみ `reminded=0` / `last_fired_at=NULL` に巻き戻し、編集後の発火が抜け落ちないようにする。タイトルやリマインダー秒数だけの変更では通知済みフラグは温存する。
- 祝日テーブルは内蔵 (ハッピーマンデー + 振替休日対応)。

### Reminder

**Purpose**: 予定の N 分前にチャイム + トースト + (任意で) VOICEVOX 音声を再生する。

#### Components

- `services/reminder.ts`
- バックエンド: `commands::reminder::check_due_reminders`

#### Behavior

- 30 秒間隔のポーリング (`setTimeout` 再帰)。
- バックエンドは取得と同時に `reminded=1` にマークし、二重発火を防止。
- 連続失敗時は指数バックオフ (30s → 60s → 120s → 240s → 300s cap)。
- 3 回連続失敗で 1 度だけ警告トーストを表示 (回復時に消える)。
- 設定 `reminder_sound_enabled` で通知音、`voicevox_enabled` + `voice_character` で音声を制御。
- ボイスファイルは `<character>_<timeKey>.wav` 形式で同梱。`TIME_KEYS = {5:"5min", 10:"10min", ...}`。
- トーストクリックで該当日付の HomePage フォーカスビューに遷移。

### Snapshot

**Purpose**: 四半期サマリーと年間レビューを封筒開封演出付きで表示する。

#### Components

- `components/SnapshotModal.ts`
- `animations/snapshot.ts` (封筒開封演出)
- バックエンド: `commands::snapshot::get_snapshot_summary`

#### Behavior

- 起動時に `pending_review` キーが返ると、トーストで誘導 → クリックでモーダル開封。
- `key` 形式: `annual_YYYY` または `snapshot_YYYY-Qn`。
  - `annual_YYYY` → YYYY-01-01 〜 YYYY-12-31
  - `snapshot_YYYY-Qn` → Q1=4-6 / Q2=7-9 / Q3=10-12 / Q4=1-3
- 集計値: `event_count` (予定数), `memo_day_count` (メモが書かれた日数), `memo_char_total` (Unicode 文字数)
- ユーザーがモーダルを閉じる or トーストを閉じると `mark_review_seen(key)` で既読化。

### Settings

**Purpose**: 書体・表示・通知音・VOICEVOX 話者・StellaRecord 連携の各設定を編集する。

#### Setting Items

| 設定                     | 型      | デフォルト      | 説明                                  |
| ------------------------ | ------- | --------------- | ------------------------------------- |
| `font_family`            | TEXT    | `Yomogi`        | メモ書体 (Google Fonts)               |
| `font_scope`             | TEXT    | `content_only`  | 書体適用範囲 (`content_only` / `all`) |
| `memo_max_length`        | INTEGER | `1000`          | メモ最大文字数                        |
| `transition_enabled`     | BOOLEAN | `1`             | ページ遷移アニメ                      |
| `snapshot_enabled`       | BOOLEAN | `1`             | スナップショット表示                  |
| `view_hour_start`        | INTEGER | (空文字 = 自動) | タイムライン開始時 (0-29)             |
| `view_hour_end`          | INTEGER | (空文字 = 自動) | タイムライン終了時 (1-30)             |
| `voicevox_enabled`       | BOOLEAN | `0`             | VOICEVOX 読み上げ                     |
| `voice_character`        | TEXT    | `metan`         | 話者キャラクター ID                   |
| `reminder_sound_enabled` | BOOLEAN | `1`             | 通知音                                |
| `onboarding_completed`   | BOOLEAN | `0`             | (現状ロジック未配線)                  |

`view_hour_start` / `view_hour_end` は順序依存があるため、`set_view_hour_range(start, end)` で原子的に更新する (途中状態で start>=end を拒否されるのを防ぐ)。

---

## IPC Reference

`src-tauri/src/lib.rs` の `tauri::generate_handler!` で登録された 21 コマンド。

### startup

| Command                     | Args                 | Returns                     | Description                                |
| --------------------------- | -------------------- | --------------------------- | ------------------------------------------ |
| `get_startup_info`          | -                    | `StartupInfo`               | 接続状態 + pending 通知 + pending レビュー |
| `get_pending_notifications` | -                    | `Vec<ScheduleNotification>` | 起動時通知の再取得                         |
| `dismiss_notification`      | `source_ref: String` | `()`                        | 通知を恒久 dismiss                         |
| `mark_review_seen`          | `key: String`        | `()`                        | レビューキーを既読化                       |

### journal

| Command                | Args                         | Returns        | Description                                              |
| ---------------------- | ---------------------------- | -------------- | -------------------------------------------------------- |
| `get_week_lane_data`   | `week_start: String`         | `WeekLaneData` | 指定週のレーンデータ                                     |
| `get_day_focus_data`   | `date: String`               | `DayFocusData` | 1 日分の全データ                                         |
| `save_day_memo`        | `date: String, memo: String` | `()`           | メモ保存 (`memo_max_length` 設定値で切り詰め、既定 1000) |
| `add_manual_marker`    | `date, start, end, color`    | `i64`          | 手動マーカー追加                                         |
| `remove_manual_marker` | `id: i64`                    | `()`           | 手動マーカー削除                                         |

### calendar

| Command                 | Args                                                                        | Returns     | Description                                                   |
| ----------------------- | --------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| `get_month_data`        | `year, month`                                                               | `MonthData` | 月内のアクティブ日 + 予定                                     |
| `add_event`             | `title, scheduled_at, remind_minutes_before, is_recurring, recurrence_kind` | `i64`       | 予定追加                                                      |
| `remove_event`          | `id: i64`                                                                   | `()`        | 予定削除                                                      |
| `update_calendar_event` | `id, title, scheduled_at, recurrence_kind, remind_minutes_before`           | `()`        | 既存予定を編集。`scheduled_at` 変更時は `reminded` を巻き戻す |

### settings

| Command               | Args                         | Returns        | Description          |
| --------------------- | ---------------------------- | -------------- | -------------------- |
| `get_settings`        | -                            | `MiraSettings` | 全設定取得           |
| `set_setting`         | `key: String, value: String` | `()`           | 1 キー更新           |
| `set_view_hour_range` | `start: u8, end: u8`         | `()`           | 表示時間帯を原子更新 |

### reminder

| Command               | Args | Returns              | Description                                        |
| --------------------- | ---- | -------------------- | -------------------------------------------------- |
| `check_due_reminders` | -    | `Vec<ReminderEvent>` | 期限到来したリマインダー (取得と同時に reminded=1) |

### snapshot

| Command                | Args          | Returns           | Description     |
| ---------------------- | ------------- | ----------------- | --------------- |
| `get_snapshot_summary` | `key: String` | `SnapshotSummary` | 四半期/年間集計 |

### stella

| Command                        | Args | Returns  | Description                     |
| ------------------------------ | ---- | -------- | ------------------------------- |
| `check_stellarecord_available` | -    | `bool`   | DB ファイル実在確認             |
| `register_to_stellarecord`     | -    | `String` | StellaRecord の apps へ自己登録 |
| `unregister_from_stellarecord` | -    | `String` | apps から登録解除               |

### Payload Types

| Type                                                                                                                                                                                                                                                                  | Location                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `StartupInfo`, `ScheduleNotification`, `MiraSettings`, `ReminderEvent`, `SnapshotSummary`, `WeekLaneData`, `DayLane`, `VisitBlock`, `VisitPlayer`, `DayFocusData`, `PhotoEntry`, `MarkerSpan`, `ManualMarker`, `MemokittoChip`, `MonthData`, `CalendarEvent`, `TabId` | `src/state/types.ts` (TS) / `src-tauri/src/commands/*.rs` (Rust) |

---

## Data Flow

### Startup

```
React-less app.ts: initApp()
  ├─ Navbar 構築
  ├─ pageContainer 作成
  └─ loadStartupWithRetry(3 attempts, exponential backoff 1s/2s/4s)
       └─ invoke("get_startup_info")
            ▶ stellaConnected = info.stella_connected
            ▶ notifications.set(info.pending_notifications)
       └─ invoke("get_settings")
            ▶ settings.set(userSettings)
            ▶ CSS custom property --memo-font を適用
       └─ if pending_notifications → showStartupReminder
       └─ if pending_review → showReviewToast
       └─ startReminderService()
       └─ registerToStellarecord()  (fire-and-forget)
  └─ mountPage("home")
```

### Week Lane Load

```
HomePage: loadWeek()
  └─ updateSubLabel()  週ラベル更新
  └─ laneWrap.add("lane-switching")  120ms フェードアウト
  └─ invoke("get_week_lane_data", { weekStart })
       │
       ▼ (Rust)
  journal::get_week_lane_data:
    ├─ lock_stella() (read-only)
    ├─ time_range::detect_activity_range() で表示時間帯算出
    ├─ for day in 7 日:
    │     ├─ visit_summary から訪問取得
    │     ├─ world_color::get_or_create_color() で色を決定
    │     │   (mira_world_colors にキャッシュ)
    │     └─ with_users から同席ユーザー取得 (オプション)
    └─ return WeekLaneData
  └─ renderLane(data)
  └─ laneWrap.remove("lane-switching")
```

### Day Focus Load

```
focusedDate.set(date)
  └─ HomePage の subscribe ハンドラ:
       └─ enterFocusMode(date)
            └─ loadMemo(date)
                 └─ invoke("get_day_focus_data", { date })
                      │
                      ▼ (Rust)
                 journal::get_day_focus_data:
                   ├─ lock_mira(): user_memo, manual_markers
                   ├─ lock_stella(): visits + photos + players
                   ├─ marker::detect_markers(memo, observed_names)
                   ├─ memokitto::build_memokitto(observed_names, memo)
                   └─ return DayFocusData
                 └─ renderMemo(data)
```

### Reminder Polling

```
services/reminder.ts: scheduleNext()
  └─ setTimeout(pollReminders, currentIntervalMs)
       └─ invoke("check_due_reminders")
            │
            ▼ (Rust)
       reminder::check_due_reminders:
         ├─ lock_mira()
         ├─ SELECT 期限到来 events WHERE reminded=0
         ├─ UPDATE reminded=1  (同トランザクション内)
         └─ return Vec<ReminderEvent>
       └─ for r in reminders:
            ├─ playChime() if reminder_sound_enabled
            ├─ showReminderToast(r)
            └─ playVoiceFile(voice_character, r.minutes_until) if voicevox_enabled
       └─ scheduleNext()  (再帰)
```

---

## State Management

フロントエンドの状態管理は自作の `Store<T>` クラスで構成される。React 等の UI ライブラリは使用しない。

### Store<T>

```typescript
class Store<T> {
  get(): T;
  set(next: T): void; // Object.is 比較で同値スキップ
  subscribe(fn: Listener<T>): () => void; // 登録時には発火しない
  subscribeImmediate(fn: Listener<T>): () => void; // 登録時に現在値で 1 度発火
}
```

### Global Stores

| Store              | Type                     | Purpose                                                         |
| ------------------ | ------------------------ | --------------------------------------------------------------- |
| `activeTab`        | `TabId`                  | 現在のナビゲーションタブ (`home`/`calendar`/`settings`/`debug`) |
| `focusedDate`      | `string \| null`         | HomePage でフォーカス中の日付                                   |
| `currentWeekStart` | `string`                 | 表示中の週開始日 (月曜)                                         |
| `currentMonth`     | `{year, month}`          | CalendarPage で表示中の年月                                     |
| `settings`         | `MiraSettings`           | アプリ全体設定                                                  |
| `stellaConnected`  | `boolean`                | StellaRecord DB 接続状態                                        |
| `notifications`    | `ScheduleNotification[]` | 起動時取得した予定通知                                          |

### Subscriptions Collector

ページコンポーネントは `Subscriptions` インスタンスを受け取り、購読解除関数を `add()` で登録する。タブ切替時に `app.ts` が `dispose()` で全解除する。

---

## Concurrency Model

### Shared State (Backend)

| Resource        | Synchronization                                  |
| --------------- | ------------------------------------------------ |
| Mira DB         | `Mutex<Connection>` (DbState の mira フィールド) |
| StellaRecord DB | `Mutex<Option<Connection>>` (未接続時は None)    |

ロック取得は `db::lock_mira` / `db::lock_stella` ヘルパー経由のみ。poisoned 時はユーザー向けエラー文字列を返す (panic させない)。

### Write Exclusion

書き込みは Mira DB のみ。IPC ハンドラは同期的に lock → 操作 → drop で短時間ロック。長時間ロックする処理は存在しない。

### Read Concurrency

WAL モードにより、Mira DB / StellaRecord DB ともに書き込み中でも読み取り可能。StellaRecord は `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON` で物理的に書き込みを禁止する。

---

## StellaRecord Integration

### Detection

`stella_db::find_stella_db_path`:

1. 新レイアウト: `HKCU\Software\CosmoArtsStore\StellaRecord\InstallLocation` + `\Data\db\stellarecord.db`
2. 旧バージョン互換: `HKCU\Software\CosmoArtsStore\StellaRecord\DbPath` の値を直接使用

存在しない場合は `stella_connected = false` となり、HomePage は再接続 UI を表示する。

### Read Access

`stella_db::try_connect`:

- `SQLITE_OPEN_READ_ONLY` で開く
- `busy_timeout(5 秒)` で StellaRecord の書込ロックを許容
- `PRAGMA query_only = ON` で SELECT 以外を実行時拒否

### Write Access (apps テーブルへの自己登録)

`commands::stella::register_to_stellarecord`:

- StellaRecord 本体と一致する `apps` スキーマを `IF NOT EXISTS` で作成
- 既存レコードと name / description / icon が一致する場合は UPDATE をスキップ (~1MB BLOB 再書き込みを防ぐ)
- `ON CONFLICT(path) DO UPDATE` で upsert

### Schema Dependencies

Mira は以下の StellaRecord テーブル / ビューに依存する:

- `visits` (世界訪問)
- `with_users` (同席ユーザー)
- `screenshots` (写真)
- `find_users` (ユーザーカタログ)
- `visit_summary` ビュー (滞在時間付き)

`world_id` は StellaRecord 側に列が存在しないため、Mira は `world_name` 文字列を世界識別子として使用する (ワールド改名で別世界扱いになる制約あり)。

---

## Security Model

### Threat Model

シングルユーザーのデスクトップアプリケーション。マルチテナント・ネットワーク経由の攻撃は対象外。

### Mitigations

| Threat                         | Mitigation                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| WebView 経由の任意 OS API 実行 | Tauri Capabilities で最小権限                                 |
| StellaRecord DB の誤書き込み   | `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON` の二重防御 |
| SQL インジェクション           | 全クエリで `params!` バインド                                 |
| 予期せぬ panic                 | clippy で `unwrap_used / expect_used / panic = deny`          |
| 起動失敗時のクラッシュ         | stderr 記録のうえ正常 return                                  |
| Google Fonts の外部接続        | 起動時 1 度のみ、CSP で許可ドメインを限定                     |

### Out-of-Scope

- コード署名 (未実装)
- 自動アップデート (未実装)
- DB 暗号化 (ローカル FS 権限に依存)

---

## Persistence

### Filesystem Layout

```
%LOCALAPPDATA%\Programs\Mira\
├── Mira.exe
├── ...
└── Data/
    ├── db/
    │   ├── mira.db                    SQLite メイン DB
    │   ├── mira.db-wal                Write-Ahead Log
    │   └── mira.db-shm                共有メモリ
    └── EBWebView/                     WebView2 ユーザーデータ
```

### Windows Registry

| Key                                 | Value Name        | Type   | Description                   |
| ----------------------------------- | ----------------- | ------ | ----------------------------- |
| `HKCU\Software\CosmoArtsStore\Mira` | `InstallLocation` | REG_SZ | NSIS が書き込むインストール先 |

StellaRecord 連携用に以下を参照 (Mira は書き込まない):

| Key                                         | Value Name          | Type   |
| ------------------------------------------- | ------------------- | ------ |
| `HKCU\Software\CosmoArtsStore\StellaRecord` | `InstallLocation`   | REG_SZ |
| `HKCU\Software\CosmoArtsStore\StellaRecord` | `DbPath` (旧版互換) | REG_SZ |

### LocalStorage

| Key                                                        | Value                | Description                                                                                                       |
| ---------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pending_mark_review_seen`                                 | `string[]` JSON      | `mark_review_seen` API 失敗時のリトライキュー (R2-H-5)                                                            |
| `mira:remind_minutes_before_default` (旧版互換 / 移送のみ) | `"5" \| "10" \| ...` | Loop 1〜6 で利用していたフロント側キャッシュ。Loop 9 R2-M-20 で DB (`mira_settings`) に統合済。起動時に DB へ移送 |

---

## Known Limitations

| Limitation                                                      | Impact                                     | Mitigation                                                   |
| --------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `world_name` ベースで世界を識別するため、改名で別世界扱いになる | `mira_world_colors` に旧名残存             | StellaRecord 側に `world_id` が保存されるまで仕様として受容  |
| StellaRecord 未接続時はホーム画面が空状態                       | データ参照不可                             | 「再接続」ボタンで `get_startup_info` 再試行                 |
| Google Fonts CDN への外部接続が初回起動時に発生                 | オフライン環境では既定書体にフォールバック | フォントを同梱する将来計画あり                               |
| 多言語化未対応                                                  | 日本語固定                                 | i18n は未実装                                                |
| Windows のみ対応                                                | macOS / Linux で動作不可                   | 設計上 `winreg` 依存                                         |
| コード署名なし                                                  | SmartScreen 警告                           | 商用配布時に対応予定                                         |
| メモ最大長は固定 1000 文字                                      | 長文不可                                   | 設定で変更可能だがバックエンドの切り詰めも同期して変更が必要 |

---

## 関連ドキュメント

- [database.md](database.md) — Mira DB のスキーマ定義・マイグレーション戦略・StellaRecord DB 参照経路
- [tech-stack.md](tech-stack.md) — 技術選定の経緯・依存バージョン・ADR
- [../README.md](../README.md) — ユーザー向け概要・機能説明
- [../DEVELOPMENT.md](../DEVELOPMENT.md) — 開発者向けセットアップ手順
