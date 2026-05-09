# Mira

VRChat の活動を振り返るジャーナルアプリケーション。STELLA RECORD の SQLite データベースから訪問履歴・出会い・写真を読み取り、タイムライン形式で可視化します。

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, Vite (Vanilla DOM + カスタムリアクティブストア) |
| Backend | Rust (Edition 2021), Tauri v2 |
| Database | SQLite (rusqlite) — STELLA RECORD DB を参照 |
| Styling | CSS Custom Properties, CSS Animations |

## Features

- **Weekly Timeline** — 7 日間のレーン表示、ズームコントロール付き
- **Day Focus** — 1 日の詳細ビュー（訪問ブロック、出会った人リスト）
- **Daily Memo** — ワールド名・ユーザー名の自動ハイライト付きメモ
- **Memokitto** — ロール紙風ステッカーパレットによる名前クイック挿入
- **Cork Board** — コルクボード風フォトギャラリー、ライトボックスビューア
- **Mira Snapshot** — 季節ごとのサマリーアニメーション（封筒開封演出）
- **Notification Pins** — 予定イベントの通知ピン表示
- **Page Transitions** — セクション間のアニメーション遷移

## Project Structure

```
src/                    # フロントエンド (TypeScript)
  ├── pages/            #   ページ (home, calendar, settings, debug)
  ├── components/       #   共通 UI コンポーネント
  ├── animations/       #   遷移・演出アニメーション
  ├── state/            #   リアクティブストア・型定義
  ├── styles/           #   CSS モジュール
  └── api/              #   Tauri コマンドバインディング
src-tauri/              # バックエンド (Rust)
  ├── src/commands/     #   Tauri コマンドハンドラ
  ├── src/db/           #   DB アクセス (Mira DB + STELLA RECORD DB)
  └── src/logic/        #   ビジネスロジック (markers, memokitto, colors)
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)
- [Tauri CLI](https://tauri.app/)
- Windows 10 / 11
- STELLA RECORD がインストール・設定済みであること

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

## Third-Party Assets

| File | Source | License |
|------|--------|---------|
| `src/assets/textures/wood-wall.jpg` | [ambientCG Wood026](https://ambientcg.com/view?id=Wood026) | CC0 1.0 Public Domain |
| `src/assets/textures/cork-board.jpg` | [ambientCG Cork001](https://ambientcg.com/view?id=Cork001) | CC0 1.0 Public Domain |
| `src/assets/sounds/notify-chime.mp3` | [くらげ工匠 フレーズ032](http://www.kurage-kosho.info/system.html) | Free (商用可・クレジット任意) |

## License

Proprietary — CosmoArtsStore
