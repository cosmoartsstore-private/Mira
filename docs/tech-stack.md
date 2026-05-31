# 技術スタックと設計判断 (ADR)

## 技術スタック

| 層        | 技術                                 | バージョン  | ライセンス |
| --------- | ------------------------------------ | ----------- | ---------- |
| Frontend  | TypeScript                           | ~5.9        | Apache-2.0 |
| Frontend  | Vite                                 | ^7.3        | MIT        |
| Frontend  | Vanilla DOM + 自作 `Store<T>`        | —           | —          |
| Backend   | Rust (Edition 2021)                  | 1.93.0 固定 | MIT/Apache |
| Backend   | Tauri                                | 2.2.4       | MIT/Apache |
| Backend   | rusqlite (bundled SQLite)            | 0.38        | MIT        |
| Backend   | serde                                | 1           | MIT/Apache |
| Backend   | chrono                               | 0.4         | MIT/Apache |
| Backend   | winreg                               | 0.52        | MIT        |
| Test (FE) | Vitest (+ @vitest/coverage-v8)       | ^4.1        | MIT        |
| Test (BE) | `cargo test` (組み込み)              | —           | —          |
| Lint      | ESLint / typescript-eslint / unicorn | ^9 / ^8     | MIT        |
| Lint      | Stylelint (standard)                 | ^16         | MIT        |
| Format    | Prettier / rustfmt                   | ^3 / —      | MIT        |

ツールチェインは [`src-tauri/rust-toolchain.toml`](../src-tauri/rust-toolchain.toml) で `1.93.0` +
`rustfmt`/`clippy` + MSVC ターゲットに固定する。

---

## Architecture Decision Records

各 ADR は `Status / Context / Decision / Consequences` で記す。

### ADR-001: アプリ基盤に Tauri v2 を採用

- **Status**: Accepted
- **Context**: 軽量・ネイティブ配布・Rust バックエンドを満たすデスクトップ基盤が必要だった。
- **Decision**: Electron ではなく Tauri v2 を採用。OS の WebView2 を使うためバイナリが小さく、
  バックエンドを Rust で書ける。
- **Consequences**: Windows では WebView2 ランタイムに依存。配布サイズとメモリ使用量で有利。

### ADR-002: フロントは React ではなく Vanilla TS + 自作 Store

- **Status**: Accepted
- **Context**: 画面数が限られ、単一値 + リスナーで足りる規模。
- **Decision**: React/Vue や RxJS を入れず、`Store<T>` (約 50 行) で状態を管理する。
- **Consequences**: 依存が最小でビルドが速い。一方で DOM 構築は手続き的になり、購読解除を
  `Subscriptions` で明示管理する規律が必要。

### ADR-003: ワールド色ハッシュに FNV-1a 64-bit を採用

- **Status**: Accepted
- **Context**: ワールド名から決定論的に色を割り当て、DB キャッシュミス時にも色を再現したい。
- **Decision**: `std` の `DefaultHasher` (SipHash) はプロセス毎に seed がランダム化され再起動で
  色が変わるため使わず、依存ゼロの FNV-1a 64-bit を自前実装する。
- **Consequences**: プロセス / OS を跨いで同一入力 → 同一色。短文字列に対する均等性も実用十分。

### ADR-004: メモのマーカー位置を UTF-16 コードユニットで扱う

- **Status**: Accepted
- **Context**: 旧版は UTF-8 byte 位置を返し、日本語混じり文で JS 側のカーソル位置とズレた。
- **Decision**: `logic::marker` と `mira_manual_markers` の位置を UTF-16 単位 (JS 文字列互換) に統一。
- **Consequences**: フロントの選択範囲とバックエンドの保存位置が一致する。

### ADR-005: 2 つの SQLite を分離 (Mira RW / StellaRecord RO)

- **Status**: Accepted
- **Context**: VRChat 活動ログは StellaRecord が所有し、Mira は自分のメモ/予定を別管理したい。
- **Decision**: Mira DB は書込可能、StellaRecord DB は読み取り専用で接続。未接続は正常系として扱い
  `stellaConnected=false` を UI に伝える。
- **Consequences**: 関心の分離が明確。`mira_world_colors` は `visit_summary` が `world_id` を持たない
  制約から `world_name` を主キーにする (R2-M-26)。

### ADR-006: unwrap/expect/panic を clippy で全面禁止

- **Status**: Accepted
- **Context**: クラッシュ系の実行時エラーをコンパイル時に潰したい。
- **Decision**: `unwrap_used` / `expect_used` / `panic` を `deny`。起動失敗も `return` で穏当に扱う。
  テストモジュールのみ `#[allow(clippy::unwrap_used)]` で例外化する。
- **Consequences**: 本番経路から panic の余地が消える。

### ADR-007: レイヤ境界を ESLint で機械強制

- **Status**: Accepted
- **Context**: レイヤ違反 (例: utils が pages を参照) を人手レビューに頼ると漏れる。
- **Decision**: `no-restricted-imports` で各レイヤの参照可能範囲を宣言し、CI で弾く。
- **Consequences**: アーキテクチャがコードで自己文書化され、退行を防げる。

### ADR-008: テストと CI を回帰ゲートとして導入

- **Status**: Accepted
- **Context**: 高品質の StellaRecord に倣い、純粋ロジックを継続的に保証したい。
- **Decision**: フロントは Vitest で `utils`/`state` の純粋関数を、バックエンドは `cargo test` で
  `logic` 層をテストする。CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) は Rust を
  windows-latest、フロントを ubuntu-latest で並列実行する。`npm run verify` でローカル一括検証。
- **Consequences**: lint + テスト + フォーマット + clippy が master への push / PR で自動実行される。
