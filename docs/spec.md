# Mira 技術仕様

VRChat の活動を振り返るジャーナルアプリケーション。STELLA RECORD の SQLite データベースから
訪問履歴・出会い・写真を読み取り、週タイムライン / 日詳細 / カレンダーで可視化する。

---

## アーキテクチャ概観

```
┌──────────────────────────────────────────────┐
│ Frontend (Vanilla TypeScript + 自作 Store<T>) │
│                                                │
│  pages ─► components / animations              │
│    │                                           │
│    ├─► api  (Tauri invoke ラッパー)            │
│    ├─► services (リマインダ等の常駐処理)       │
│    └─► state / utils (リーフ層)                │
└───────────────────────┬────────────────────────┘
                         │  Tauri IPC (invoke / JSON)
┌───────────────────────▼────────────────────────┐
│ Backend (Rust / Tauri v2)                       │
│                                                  │
│  commands/  (#[tauri::command] ハンドラ)         │
│    │                                             │
│    ├─► db/     (Mira DB 読み書き / Stella 読取)  │
│    └─► logic/  (純粋ロジック・副作用なし)        │
└───────────────────────┬─────────────────────────┘
              ┌──────────┴──────────┐
        ┌─────▼─────┐         ┌──────▼───────┐
        │  Mira DB  │         │ StellaRecord │
        │ (RW SQLite)│        │ DB (RO SQLite)│
        └───────────┘         └──────────────┘
```

### プロセスモデル

単一の Tauri プロセス。メインスレッドが Tauri ランタイムと IPC ハンドラを担い、両 DB 接続は
`DbState { mira: Mutex<Connection>, stella: Mutex<Option<Connection>> }` として `manage()` 下で共有する。
ハンドラは [`db::lock_mira`] / [`db::lock_stella`] でロックを取得する。

---

## フロントエンド構成

レイヤは ESLint の `no-restricted-imports` で機械的に強制される ([`eslint.config.js`](../eslint.config.js))。

| レイヤ     | ディレクトリ      | 依存可能な下位レイヤ                                                   |
| ---------- | ----------------- | ---------------------------------------------------------------------- |
| pages      | `src/pages/`      | components, animations, services, api, state, utils (pages 相互は禁止) |
| components | `src/components/` | services, api, state, utils                                            |
| animations | `src/animations/` | utils, state                                                           |
| services   | `src/services/`   | api, state, utils                                                      |
| api        | `src/api/`        | state, utils                                                           |
| state      | `src/state/`      | utils                                                                  |
| utils      | `src/utils/`      | (リーフ層・参照禁止)                                                   |

### 状態管理

[`src/state/store.ts`](../src/state/store.ts) の自作 `Store<T>` を採用する。

- `get()` / `set()` / `subscribe()` / `subscribeImmediate()` を持つ最小リアクティブストア
- `set()` は `Object.is` で参照同一なら通知をスキップし、無駄な再描画を避ける
- リスナーが throw しても後続リスナーをブロックしない (try/catch で隔離)
- ページ単位の購読解除は `Subscriptions` コレクターに登録し、unmount 時に `dispose()` する

主なグローバルストア: `activeTab`, `focusedDate`, `currentWeekStart`, `currentMonth`,
`settings`, `stellaConnected`, `notifications`。

---

## バックエンド構成

| モジュール  | 役割                                                                      |
| ----------- | ------------------------------------------------------------------------- |
| `lib.rs`    | エントリ。DB 初期化 → `manage()` → WebView2 データ位置固定 → コマンド登録 |
| `commands/` | `#[tauri::command]` ハンドラ。ファイル名 = フロントの機能領域             |
| `db/`       | `DbState`、両 DB のオープン、ロックヘルパー、スキーマ migration           |
| `logic/`    | DB / Tauri に依存しない純粋ロジック                                       |

### logic 層 (純粋・テスト対象)

| モジュール    | 関数                    | 説明                                                  |
| ------------- | ----------------------- | ----------------------------------------------------- |
| `world_color` | `generate_color`        | FNV-1a でワールド名から決定論的に 12 色パレットを選ぶ |
| `marker`      | `find_markers`          | メモ中のワールド/人名を検出し UTF-16 位置で返す       |
| `memokitto`   | `extract`               | 指定日の訪問ワールド・同席ユーザーをチップ化          |
| `time_range`  | `detect_activity_range` | 直近 30 日の活動から週レーンの表示時間帯を推定        |

### IPC コマンド一覧

[`lib.rs`](../src-tauri/src/lib.rs) の `invoke_handler!` に登録される。

| 領域     | コマンド                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------- |
| startup  | `get_startup_info`, `get_pending_notifications`, `dismiss_notification`, `mark_review_seen`              |
| journal  | `get_week_lane_data`, `get_day_focus_data`, `save_day_memo`, `add_manual_marker`, `remove_manual_marker` |
| calendar | `get_month_data`, `add_event`, `remove_event`                                                            |
| settings | `get_settings`, `set_setting`, `set_view_hour_range`                                                     |
| reminder | `check_due_reminders`                                                                                    |
| snapshot | `get_snapshot_summary`                                                                                   |
| stella   | `check_stellarecord_available`, `register_to_stellarecord`, `unregister_from_stellarecord`               |

引数キーは Rust の関数引数名 (camelCase 自動変換) に一致させる。フロント側の窓口は
[`src/api/commands.ts`](../src/api/commands.ts)。

---

## エラーハンドリング方針

- **Rust**: コマンドは `Result<T, String>` を返し、`String` はユーザー向け日本語メッセージ。
  `unwrap` / `expect` / `panic` は clippy で **コンパイル時に禁止** (deny)。起動失敗も panic させず
  stderr に記録して return する。
- **TypeScript**: `catch (e: unknown)` に統一し、`errMessage(e)` で文字列化して toast 表示。
  非同期処理の浮き (`no-floating-promises`) は ESLint で禁止。

---

## データとプライバシー

すべてのデータはローカルの SQLite に保存され、外部送信・テレメトリは行わない。StellaRecord DB は
読み取り専用で開き、Mira が書き換えることはない。

---

## 既知の制約

- Windows 専用 (WebView2 / レジストリ前提)
- 祝日計算は当該月内で完結する判定のみ (月境界跨ぎの国民の休日は未対応 — R2-M-21)
- お気に入りユーザー機能は撤去済み (R2-M-23)
