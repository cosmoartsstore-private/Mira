# Mira — 新機能実装仕様書（CODEX向け）

> この仕様書を必ず最初から最後まで読んでから実装を開始すること。
> 各セクションに「実装すること」と「実装しないこと」を明記している。
> 不明な箇所は実装を止めて確認すること。勝手な補完・拡張をしないこと。

---

## 前提：アプリ構造の確認

```
src/
  pages/home/HomePage.ts       ← HOME ページ（最重要ファイル）
  pages/settings/SettingsPage.ts
  api/commands.ts              ← Tauri IPC ラッパー（全コマンドのリスト）
  state/store.ts               ← リアクティブストア
  state/types.ts               ← IPC 型定義
  styles/
    tokens.css                 ← デザイントークン（変更不可）
    home.css                   ← ホームレイアウト
    memo.css                   ← メモ・フォーカスビュー
    layout.css                 ← navbar・settings・共通
src-tauri/src/
  commands/
    journal.rs                 ← get_week_lane_data, get_day_focus_data 等
    settings.rs
    startup.rs
  db/
    mira_db.rs
    migrations.rs              ← テーブル作成・カラム追加はここ
  lib.rs                       ← invoke_handler に全コマンド登録
```

---

## 機能 A：統計ビュー（HOME の第3モード）

### A-1. 概要

HOME ページに「タイムライン」と「統計」を切り替えるタブを追加する。
統計ビューはタイムライン・フォーカスビューとは**排他**で表示される。

### A-2. UI 構造（DOM の挿入位置）

`HomePage.ts` の `container` 構造は現状:

```
container.home-page
  pageHead.page-head
  weekNav.week-nav          ← ここ
  backBtn.back-btn
  homeLayout.home-layout
    laneWrap.lane-wrap
    memoPaper.memo-paper
```

変更後:

```
container.home-page
  pageHead.page-head
  homeModeTabs.home-mode-tabs   ← ★NEW★ pageHead の直後に挿入
    tabTimeline.home-mode-tab.active  "タイムライン"
    tabStats.home-mode-tab            "統計"
  weekNav.week-nav              ← タイムラインモード時のみ表示
  backBtn.back-btn
  homeLayout.home-layout        ← タイムラインモード時のみ表示
  homeStats.home-stats          ← ★NEW★ 統計モード時のみ表示
```

### A-3. モード切替ロジック

- `homeModeTabs` のタブをクリックで `currentHomeMode` を切り替える（`'timeline'` | `'stats'`）
- `'timeline'` のとき: `weekNav`, `homeLayout` を表示。`homeStats` は `display:none`
- `'stats'` のとき: `weekNav` を `display:none`。`homeLayout` を `display:none`。`homeStats` を表示
- フォーカスモード（`focusedDate.get() !== null`）のとき: `homeModeTabs` 全体を `display:none`（フォーカスモードと統計モードは共存しない）
- `focusedDate` が `null` に戻ったとき: `homeModeTabs` を再表示。モードは `'timeline'` に戻す

### A-4. CSS（home.css に追加）

```css
/* ホームビュー切替タブ */
.home-mode-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
}

.home-mode-tab {
  padding: 7px 20px;
  font-size: 13px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--ink-faint);
  cursor: pointer;
  font-family: var(--ui-font);
  letter-spacing: 0.03em;
  transition: color 0.2s, border-bottom-color 0.2s;
}

.home-mode-tab:hover { color: var(--ink-soft); }

.home-mode-tab.active {
  color: var(--dusk-orange);
  border-bottom-color: var(--dusk-orange);
}

/* フォーカスモード中は切替タブを隠す */
.home-page.focus-mode .home-mode-tabs { display: none; }

/* 統計ビューコンテナ */
.home-stats {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 20px;
}
```

### A-5. 統計ビューの内部 DOM（`buildStatsView()` 関数として実装）

```
homeStats.home-stats
  statsHeader.stats-header
    statsTitle.stats-title          "Activity Overview"
    periodSelector.period-selector
      [7日][30日][90日][全期間] ← .period-btn, クリックで active クラス切替
  summaryCards.summary-cards        ← CSS grid 4列
    [アクティブ日数][セッション数][メモ日数][メモ文字数]
  statsGrid.stats-grid              ← CSS grid 2列
    [よく訪れたワールド]
    [曜日別アクティビティ]
    [時間帯別ヒートマップ] ← full-width
```

統計データは後述の Rust コマンド `get_home_stats` から取得する。
期間ボタン変更時に `get_home_stats(days)` を再度呼ぶ。

### A-6. Rust コマンド（`src-tauri/src/commands/journal.rs` に追加）

**コマンド名:** `get_home_stats`

**引数:**
```rust
#[derive(serde::Deserialize)]
pub struct HomeStatsArgs {
    pub days: u32,  // 7 / 30 / 90 / 0 (0 = 全期間)
}
```

**返り値:**
```rust
#[derive(serde::Serialize)]
pub struct HomeStatsData {
    pub active_days: u32,        // アクティブ日数（StellaRecord visit_summary から）
    pub session_count: u32,      // 訪問セッション数（visit_summary の行数）
    pub memo_days: u32,          // メモを書いた日数（mira_journal_entries から）
    pub memo_chars: u32,         // メモ合計文字数
    pub world_ranking: Vec<WorldRankEntry>,    // 最大10件
    pub weekday_counts: [u32; 7],              // [月, 火, 水, 木, 金, 土, 日]
    pub hour_counts: [[u32; 24]; 7],           // [曜日][時間帯] の訪問カウント
}

#[derive(serde::Serialize)]
pub struct WorldRankEntry {
    pub world_name: String,
    pub visit_count: u32,
}
```

**StellaRecord DB クエリ例（読み取り専用）:**
```sql
-- world_ranking
SELECT world_name, COUNT(*) as cnt
FROM visit_summary
WHERE date >= date('now', '-30 days')
GROUP BY world_name
ORDER BY cnt DESC
LIMIT 10;

-- weekday_counts
SELECT strftime('%w', date) as dow, COUNT(*) as cnt
FROM visit_summary
WHERE date >= date('now', '-30 days')
GROUP BY dow;
-- ※ strftime('%w') は 0=日曜なので、月=1..日=0 に変換して [月..日] の配列に詰める

-- hour_counts: 訪問ブロックの start_hour を使う
SELECT strftime('%w', date) as dow,
       CAST(start_time / 3600 AS INTEGER) as hour,
       COUNT(*) as cnt
FROM visits  -- 実際のテーブル名は StellaRecord のスキーマに合わせる
WHERE ...
```

**注意:** StellaRecord のテーブル/ビュー名は `src-tauri/src/db/stella_db.rs` を必ず参照すること。
勝手にテーブル名を決めないこと。

**lib.rs への登録:**
```rust
// invoke_handler の generate_handler! リストに追加
get_home_stats,
```

**commands.ts への追加:**
```typescript
export async function getHomeStats(days: number): Promise<HomeStatsData> {
  return await invoke("get_home_stats", { days });
}
```

**types.ts への追加:**
```typescript
export interface HomeStatsData {
  active_days: number;
  session_count: number;
  memo_days: number;
  memo_chars: number;
  world_ranking: WorldRankEntry[];
  weekday_counts: [number, number, number, number, number, number, number];
  hour_counts: number[][];
}
export interface WorldRankEntry {
  world_name: string;
  visit_count: number;
}
```

### A-7. 実装しないこと（統計ビュー）

- ❌ 「よく一緒にいた人」ランキング — 他ユーザーの情報を集計するため実装しない
- ❌ グラフライブラリの導入 — Chart.js 等は使わない。純粋な CSS バーで実装する
- ❌ ページ遷移アニメーション — 既存の transition-cover は使わない。tabs 内の切替のみ
- ❌ StellaRecord DB への書き込み — 一切書かない

---

## 機能 B：ムード・タグ記録（フォーカスビューに追加）

### B-1. 概要

日次フォーカスビューの `memo-inner` 内に、その日の「気分」と「タグ」を記録できる UI を追加する。
テキストメモとは別に構造化データとして DB に保存する。

### B-2. DOM の挿入位置（`renderMemo()` 内）

現在の `memoInner` への追記順序:

```
memoInner
  dateEl.memo-date                 ← 既存
  noteCard.memo-note-card          ← 既存
  kitto-sticker-board              ← 既存（オプション）
  statsEl.memo-stats               ← 既存
  photosEl.memo-photos             ← 既存
```

変更後:

```
memoInner
  dateEl.memo-date
  moodSection.memo-mood-section    ← ★NEW★ dateEl の直後
  tagSection.memo-tag-section      ← ★NEW★ moodSection の直後
  noteCard.memo-note-card
  kitto-sticker-board
  statsEl.memo-stats
  photosEl.memo-photos
```

### B-3. CSS（memo.css に追加）

```css
/* ムードピッカー — wood-wall 背景上の paper card */
.memo-mood-section {
  position: relative;
  z-index: 1;
  margin-bottom: 14px;
  background: rgba(250, 244, 232, 0.88);
  border: 1px solid rgba(160, 140, 110, 0.4);
  box-shadow: 1px 2px 6px rgba(0, 0, 0, 0.14);
  padding: 14px 20px;
  animation: memo-fade-up 0.45s ease both;
  animation-delay: 0.08s;
}

.mood-section-label {
  font-family: var(--heading-font);
  font-style: italic;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-bottom: 12px;
}

.mood-picker {
  display: flex;
  gap: 6px;
}

.mood-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 10px 6px;
  background: transparent;
  border: 1px solid rgba(160, 140, 110, 0.3);
  cursor: pointer;
  border-radius: 2px;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
}

@media (hover: hover) {
  .mood-btn:hover {
    border-color: var(--dusk-gold);
    background: rgba(212, 154, 74, 0.06);
  }
}

.mood-btn.selected {
  border-color: var(--dusk-orange);
  background: rgba(200, 99, 58, 0.08);
  box-shadow: inset 0 0 0 1px var(--dusk-orange);
}

.mood-btn:focus-visible {
  outline: 2px solid var(--dusk-orange);
  outline-offset: 2px;
}

.mood-emoji { font-size: 22px; line-height: 1; }

.mood-label {
  font-family: var(--content-font);
  font-size: 10.5px;
  color: var(--ink-soft);
  white-space: nowrap;
}

.mood-btn.selected .mood-label { color: var(--dusk-orange); }

/* タグ */
.memo-tag-section {
  position: relative;
  z-index: 1;
  margin-bottom: 14px;
  background: rgba(250, 244, 232, 0.88);
  border: 1px solid rgba(160, 140, 110, 0.4);
  box-shadow: 1px 2px 6px rgba(0, 0, 0, 0.14);
  padding: 12px 20px;
  animation: memo-fade-up 0.45s ease both;
  animation-delay: 0.1s;
}

.tag-section-label {
  font-family: var(--heading-font);
  font-style: italic;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--ink-faint);
  margin-bottom: 10px;
}

.day-tag-chips { display: flex; flex-wrap: wrap; gap: 6px; }

.day-tag-chip {
  padding: 4px 11px;
  font-size: 11.5px;
  background: transparent;
  border: 1px solid rgba(160, 140, 110, 0.4);
  cursor: pointer;
  border-radius: 12px;
  font-family: var(--content-font);
  color: var(--ink-soft);
  transition: border-color 0.18s, background 0.18s, color 0.18s;
}

@media (hover: hover) {
  .day-tag-chip:hover { border-color: var(--dusk-orange); color: var(--dusk-orange); }
}

.day-tag-chip.active {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}

.day-tag-chip:focus-visible {
  outline: 2px solid var(--dusk-orange);
  outline-offset: 2px;
}

.day-tag-chip-add {
  border-style: dashed;
  color: var(--ink-mute);
}

@media (hover: hover) {
  .day-tag-chip-add:hover { color: var(--dusk-orange); border-color: var(--dusk-orange); }
}
```

### B-4. DB 変更（migrations.rs に追加）

**`mira_journal_entries` に 2 カラムを追加（ALTER TABLE で安全に）:**

```sql
-- mood: null = 未設定。値は 'best' | 'good' | 'calm' | 'neutral' | 'tired'
ALTER TABLE mira_journal_entries ADD COLUMN mood TEXT;

-- tags: カンマ区切り文字列。null または空文字 = タグなし
-- 例: "新ワールド探索,写真撮影"
ALTER TABLE mira_journal_entries ADD COLUMN tags TEXT;
```

**既存 `mira_journal_entries` の DDL（参照用）:**
```sql
CREATE TABLE IF NOT EXISTS mira_journal_entries (
    date TEXT PRIMARY KEY,
    memo TEXT NOT NULL DEFAULT ''
);
```

**変更後（migration として追加）:**
```sql
ALTER TABLE mira_journal_entries ADD COLUMN mood TEXT;
ALTER TABLE mira_journal_entries ADD COLUMN tags TEXT;
```

Rust の migration では `IF NOT EXISTS` 相当のガードとして実行前に
`SELECT COUNT(*) FROM pragma_table_info('mira_journal_entries') WHERE name='mood'`
で存在チェックしてから ALTER する（rusqlite での一般的なパターン）。

### B-5. IPC コマンド変更

#### `get_day_focus_data` の返り値に追加

`DayFocusData`（`src-tauri/src/commands/journal.rs`）に 2 フィールドを追加:

```rust
pub struct DayFocusData {
    // 既存フィールドはそのまま
    pub mood: Option<String>,    // ★NEW★ null = 未設定
    pub tags: Vec<String>,       // ★NEW★ 空配列 = タグなし
}
```

SQL:
```sql
SELECT memo, mood, tags FROM mira_journal_entries WHERE date = ?1
```

`tags` は DB から `TEXT` として取り出し、空でなければ `,` で split して `Vec<String>` にする。

#### 新コマンド `save_day_mood`

```rust
// journal.rs に追加
#[tauri::command]
pub async fn save_day_mood(
    state: tauri::State<'_, AppState>,
    date: String,
    mood: Option<String>,    // None = 未設定クリア
) -> Result<(), MiraError> {
    let conn = state.db.lock().map_err(/* ... */)?;
    conn.execute(
        "INSERT INTO mira_journal_entries (date, memo, mood)
         VALUES (?1, '', ?2)
         ON CONFLICT(date) DO UPDATE SET mood = excluded.mood",
        rusqlite::params![date, mood],
    )?;
    Ok(())
}
```

#### 新コマンド `save_day_tags`

```rust
#[tauri::command]
pub async fn save_day_tags(
    state: tauri::State<'_, AppState>,
    date: String,
    tags: Vec<String>,
) -> Result<(), MiraError> {
    let tags_str = if tags.is_empty() { None } else { Some(tags.join(",")) };
    let conn = state.db.lock().map_err(/* ... */)?;
    conn.execute(
        "INSERT INTO mira_journal_entries (date, memo, tags)
         VALUES (?1, '', ?2)
         ON CONFLICT(date) DO UPDATE SET tags = excluded.tags",
        rusqlite::params![date, tags_str],
    )?;
    Ok(())
}
```

**lib.rs への登録:**
```rust
save_day_mood,
save_day_tags,
```

**commands.ts への追加:**
```typescript
export async function saveDayMood(date: string, mood: string | null): Promise<void> {
  await invoke("save_day_mood", { date, mood });
}
export async function saveDayTags(date: string, tags: string[]): Promise<void> {
  await invoke("save_day_tags", { date, tags });
}
```

**types.ts の DayFocusData に追加:**
```typescript
export interface DayFocusData {
  // 既存フィールド（変更なし）
  mood: string | null;   // ★NEW★
  tags: string[];        // ★NEW★
}
```

### B-6. フロントエンド実装（HomePage.ts の `renderMemo()` 内）

**ムードピッカーの構築:**

```typescript
// renderMemo() の memoInner.appendChild(dateEl); の直後に挿入

const MOODS = [
  { key: 'best',    emoji: '😄', label: '最高' },
  { key: 'good',    emoji: '😊', label: '楽しかった' },
  { key: 'calm',    emoji: '😌', label: '穏やか' },
  { key: 'neutral', emoji: '😐', label: '普通' },
  { key: 'tired',   emoji: '😔', label: '疲れた' },
] as const;

const moodSection = document.createElement('div');
moodSection.className = 'memo-mood-section';
const moodLabel = document.createElement('div');
moodLabel.className = 'mood-section-label';
moodLabel.textContent = 'Today\'s Mood';
moodSection.appendChild(moodLabel);

const moodPicker = document.createElement('div');
moodPicker.className = 'mood-picker';

for (const m of MOODS) {
  const btn = document.createElement('button');
  btn.className = 'mood-btn' + (data.mood === m.key ? ' selected' : '');
  btn.innerHTML = `<span class="mood-emoji">${m.emoji}</span><span class="mood-label">${m.label}</span>`;
  btn.addEventListener('click', () => {
    const wasSelected = btn.classList.contains('selected');
    moodPicker.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
    if (!wasSelected) {
      btn.classList.add('selected');
      saveDayMood(data.date, m.key).catch((e) => showToast({ title: 'ムードの保存に失敗しました', body: errMessage(e), kind: 'error' }));
    } else {
      // 再クリックで解除
      saveDayMood(data.date, null).catch((e) => showToast({ title: 'ムードの保存に失敗しました', body: errMessage(e), kind: 'error' }));
    }
  });
  moodPicker.appendChild(btn);
}
moodSection.appendChild(moodPicker);
memoInner.appendChild(moodSection);
```

**タグセクションの構築:**

```typescript
const PRESET_TAGS = [
  '新ワールド探索', 'イベント参加', '写真撮影', 'ゲーム', '音楽・ライブ', '雑談メイン', '制作活動',
];

const tagSection = document.createElement('div');
tagSection.className = 'memo-tag-section';
const tagLabel = document.createElement('div');
tagLabel.className = 'tag-section-label';
tagLabel.textContent = 'Tags';
tagSection.appendChild(tagLabel);

const tagChips = document.createElement('div');
tagChips.className = 'day-tag-chips';

let currentTags = [...data.tags];

function saveTagsDebounced() {
  saveDayTags(data.date, currentTags).catch((e) =>
    showToast({ title: 'タグの保存に失敗しました', body: errMessage(e), kind: 'error' })
  );
}

for (const tag of PRESET_TAGS) {
  const chip = document.createElement('button');
  chip.className = 'day-tag-chip' + (currentTags.includes(tag) ? ' active' : '');
  chip.textContent = tag;
  chip.addEventListener('click', () => {
    if (currentTags.includes(tag)) {
      currentTags = currentTags.filter(t => t !== tag);
      chip.classList.remove('active');
    } else {
      currentTags = [...currentTags, tag];
      chip.classList.add('active');
    }
    saveTagsDebounced();
  });
  tagChips.appendChild(chip);
}

// カスタムタグ追加ボタン
const addChip = document.createElement('button');
addChip.className = 'day-tag-chip day-tag-chip-add';
addChip.textContent = '＋';
addChip.title = 'カスタムタグを追加';
addChip.addEventListener('click', () => {
  // prompt 使用（Tauri WebView で動作する）
  const name = window.prompt('タグ名を入力:');
  if (!name || name.trim() === '') return;
  const trimmed = name.trim().substring(0, 20); // 最大20文字
  if (currentTags.includes(trimmed)) return;
  currentTags = [...currentTags, trimmed];
  const newChip = document.createElement('button');
  newChip.className = 'day-tag-chip active';
  newChip.textContent = trimmed;
  newChip.addEventListener('click', () => {
    currentTags = currentTags.filter(t => t !== trimmed);
    newChip.classList.remove('active');
    saveTagsDebounced();
  });
  tagChips.insertBefore(newChip, addChip);
  saveTagsDebounced();
});
tagChips.appendChild(addChip);

tagSection.appendChild(tagChips);
memoInner.appendChild(tagSection);
```

### B-7. 実装しないこと（ムード・タグ）

- ❌ カレンダー上へのムードドット表示 — 今回は実装しない（将来の拡張候補）
- ❌ タグの DB 専用テーブル化 — `mira_journal_entries` のカラム追加で十分
- ❌ タグの並び替え・削除機能 — 今回はクリックで on/off のみ
- ❌ ムードの統計への反映 — 今回は記録のみ。統計ビューへの連携は今回しない
- ❌ prompt() の置き換え — 今回は window.prompt() で実装。後でカスタムモーダルに置き換える候補

---

## 機能 C：データ管理（Settings に追加）

### C-1. 概要

設定画面の**末尾**（クレジットセクションの後）に「データ管理」セクションを追加する。
テキストエクスポートとバックアップ/リストアの 2 つを提供する。

### C-2. UI 構造（SettingsPage.ts に追加）

```
SettingsPage コンテナ
  ... 既存セクション ...
  dataMgmtSection.setting-section    ← ★NEW★ 末尾に追加
    h3 "データ管理"

    --- テキストエクスポート ---
    selectRow   形式 [Markdown / プレーンテキスト]
    toggleRow   含めるデータ [日次メモ] [予定]
    exportBtn   "エクスポート"（クリックでフォルダ選択→ファイル保存）

    hr (区切り線)

    --- バックアップ / リストア ---
    backupRow   "バックアップを作成"（mira.db をフォルダにコピー）
    restoreRow  "バックアップから復元…"（.db ファイルを選択→確認ダイアログ→コピー→再起動促す）
```

### C-3. Rust コマンド

**コマンド名:** `export_journal_text`
**コマンド名:** `backup_database`
**コマンド名:** `restore_database`

#### `export_journal_text`

```rust
#[derive(serde::Deserialize)]
pub struct ExportArgs {
    pub format: String,           // "md" | "txt"
    pub include_events: bool,
    pub save_path: String,        // フロントエンドからファイルパスを渡す
}

#[tauri::command]
pub async fn export_journal_text(
    state: tauri::State<'_, AppState>,
    args: ExportArgs,
) -> Result<(), MiraError> {
    // mira_journal_entries を全件 SELECT (mood, tags も含む)
    // args.include_events が true なら mira_scheduled_events も含める
    // format に応じて Markdown または プレーンテキストで書き出す
    // std::fs::write(args.save_path, content) で保存
    Ok(())
}
```

**Markdown 出力フォーマット:**
```markdown
# Mira — Journal Export
*Generated: {date}*

---

## {YYYY-MM-DD} ({曜日})

**Mood:** {mood_label}  ← mood が Some の場合のみ
**Tags:** {tag1}, {tag2}  ← tags が空でない場合のみ

{memo_text}

---
```

**プレーンテキスト出力フォーマット:**
```
Mira Journal Export — {date}
========================================

{YYYY-MM-DD} ({曜日})
気分: {mood_label}  ← mood が Some の場合のみ
タグ: {tag1}, {tag2}  ← tags が空でない場合のみ

{memo_text}

----------------------------------------
```

メモが空の日（空文字 or null）は**出力しない**。

#### `backup_database`

```rust
#[tauri::command]
pub async fn backup_database(
    dest_path: String,    // フロントエンドからファイルパスを渡す (例: "C:\Users\...\mira-backup-2026-06-07.db")
) -> Result<(), MiraError> {
    let src = mira_db::get_db_path();
    std::fs::copy(&src, &dest_path)?;
    Ok(())
}
```

DB 接続を切らずにコピーして問題ない（WAL モードなので）。
ただし SQLite の `VACUUM INTO` コマンドを使う方法もある（ロック安全）。

#### `restore_database`

```rust
#[tauri::command]
pub async fn restore_database(
    src_path: String,    // 選択された .db ファイルのパス
) -> Result<(), MiraError> {
    // 1. src_path が SQLite ファイルか簡易チェック（先頭 16 バイトが SQLite ヘッダーか確認）
    // 2. AppState の DB 接続を lock して、先に PRAGMA wal_checkpoint(TRUNCATE) を実行
    // 3. Connection を drop（接続を閉じる）
    // 4. std::fs::copy(src_path, get_db_path())
    // 5. フロントエンドに成功を返す（フロントがアプリ再起動を促す）
    Ok(())
}
```

**重要:** AppState の Connection を drop するには `state.db` の Mutex を取得してから
Connection を一旦 close する必要がある。AppState の構造によって実装が変わる。
`src-tauri/src/lib.rs` の `AppState` 定義を必ず確認してから実装すること。

#### lib.rs への登録

```rust
export_journal_text,
backup_database,
restore_database,
```

#### commands.ts への追加

```typescript
export async function exportJournalText(args: ExportJournalArgs): Promise<void> {
  await invoke("export_journal_text", { args });
}
export async function backupDatabase(destPath: string): Promise<void> {
  await invoke("backup_database", { destPath });
}
export async function restoreDatabase(srcPath: string): Promise<void> {
  await invoke("restore_database", { srcPath });
}

export interface ExportJournalArgs {
  format: "md" | "txt";
  includeEvents: boolean;
  savePath: string;
}
```

### C-4. ファイルダイアログ

Tauri v2 では `@tauri-apps/plugin-dialog` を使う。
**既にインポートされているかを `src/api/commands.ts` と `package.json` で確認してから実装すること。**
未インストールなら `npm install @tauri-apps/plugin-dialog` を実行し、
`tauri.conf.json` の `plugins` に `"dialog": {}` を追加すること。

エクスポート時: `save({ title: 'エクスポート先を選択', defaultPath: 'mira-export.md', filters: [...] })`
バックアップ時: `save({ title: 'バックアップ先を選択', defaultPath: 'mira-backup-YYYY-MM-DD.db', filters: [{ name: 'Database', extensions: ['db'] }] })`
リストア時: `open({ title: 'バックアップファイルを選択', multiple: false, filters: [{ name: 'Database', extensions: ['db'] }] })`

### C-5. リストア確認ダイアログ（フロントエンド）

既存の `confirmDialog` ユーティリティ（`src/utils/confirmDialog.ts`）を使うこと。
独自モーダルを新規実装しないこと。

```typescript
const ok = await confirmDialog({
  message: 'バックアップから復元しますか？\n現在のデータはすべて上書きされます。',
  confirmLabel: '復元する',
  cancelLabel: 'キャンセル',
});
if (!ok) return;
// restore 処理へ
```

リストア成功後は `showToast({ title: '復元完了', body: 'アプリを再起動してください。', kind: 'info' })` を表示。
アプリの自動再起動は行わない（ユーザーに手動で再起動してもらう）。

### C-6. CSS（layout.css に追加）

setting-section は既存スタイルをそのまま使う。追加 CSS は最小限:

```css
/* データ管理セクション内の区切り線 */
.data-section-divider {
  border: none;
  border-top: 1px dashed rgba(201, 184, 150, 0.6);
  margin: 16px 0;
}

/* リストア警告バナー */
.restore-warning-banner {
  background: rgba(142, 53, 40, 0.06);
  border: 1px solid rgba(142, 53, 40, 0.2);
  border-left: 3px solid var(--dusk-red);
  padding: 10px 14px;
  font-family: var(--heading-font);
  font-style: italic;
  font-size: 12px;
  color: rgba(142, 53, 40, 0.85);
  line-height: 1.6;
  margin-top: 10px;
}
```

### C-7. 実装しないこと（データ管理）

- ❌ 写真のエクスポート — VRChat スクリーンショットは Mira の管轄外。エクスポートしない
- ❌ 設定のエクスポート — mira_settings は バックアップ (DB コピー) に含まれるので別途不要
- ❌ 自動バックアップスケジュール — 手動のみ
- ❌ クラウド同期 — 実装しない
- ❌ フレンドノート機能 — 今回のスコープ外。別途検討
- ❌ アプリの自動再起動 — リストア後はトーストで「再起動してください」と表示するのみ
- ❌ エクスポートプレビュー — Settings 画面では不要。エクスポートボタンを押したらダイアログを出す

---

## 実装順序の推奨

1. **機能 B（ムード・タグ）のDB変更** — migrations.rs に ALTER TABLE を追加
2. **機能 B の Rust コマンド** — `save_day_mood`, `save_day_tags`, `get_day_focus_data` 更新
3. **機能 B のフロントエンド** — `renderMemo()` に UI 追加
4. **機能 A の Rust コマンド** — `get_home_stats`
5. **機能 A のフロントエンド** — `buildStatsView()` と `home-mode-tabs`
6. **機能 C の Rust コマンド** — `export_journal_text`, `backup_database`, `restore_database`
7. **機能 C のフロントエンド** — SettingsPage に セクション追加

各機能は独立しているので、1 つの機能を完成させてからビルドテストすること。
一度に全機能を実装してテストするのは NG。

---

## 変更対象ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `src-tauri/src/db/migrations.rs` | `mira_journal_entries` に `mood`, `tags` カラム追加 |
| `src-tauri/src/commands/journal.rs` | `get_day_focus_data` 更新、`save_day_mood`, `save_day_tags`, `get_home_stats` 追加 |
| `src-tauri/src/commands/settings.rs` | 変更なし |
| `src-tauri/src/commands/` (新ファイル `data.rs`) | `export_journal_text`, `backup_database`, `restore_database` |
| `src-tauri/src/lib.rs` | `invoke_handler` に新コマンド登録 |
| `src/api/commands.ts` | 新コマンドの invoke ラッパーを追加 |
| `src/state/types.ts` | `DayFocusData`, `HomeStatsData`, `WorldRankEntry` 追加・更新 |
| `src/pages/home/HomePage.ts` | `home-mode-tabs`, `buildStatsView()`, `renderMemo()` 更新 |
| `src/pages/settings/SettingsPage.ts` | データ管理セクション追加 |
| `src/styles/home.css` | `.home-mode-tabs`, `.home-stats` 追加 |
| `src/styles/memo.css` | `.memo-mood-section`, `.mood-*`, `.memo-tag-section`, `.day-tag-*` 追加 |
| `src/styles/layout.css` | `.data-section-divider`, `.restore-warning-banner` 追加 |

## 変更しないファイル

- `src/styles/tokens.css` — デザイントークンは変更禁止
- `src-tauri/src/db/stella_db.rs` — StellaRecord DB は読み取り専用
- `src-tauri/src/db/mira_db.rs` — `get_db_path()` を利用するだけで変更しない
- `src/components/` — 既存コンポーネントはそのまま
- `src/services/reminder.ts` — 変更しない
- `tauri.conf.json` — dialog plugin が未導入の場合のみ変更する

---

## デザイン原則（守ること）

1. **新規 CSS カラーを勝手に追加しない** — `tokens.css` の変数だけ使う
2. **新規フォント・アイコンライブラリを導入しない** — 絵文字を直接使う
3. **フォント指定** — 見出し類は `var(--heading-font)` (Cormorant Garamond italic)、メモ類は `var(--content-font)` (Yomogi)、UI テキストは `var(--ui-font)` (Noto Sans JP)
4. **アニメーション** — 既存の `memo-fade-up` keyframe（animations.css にある）を `animation-delay` を変えて使う
5. **新規コンポーネントファイルを作らない** — 既存ファイルに追記する形で実装する

---

*最終更新: 2026-06-08*
