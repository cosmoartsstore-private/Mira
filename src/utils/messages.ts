// UI 表示文字列の集約点。
//
// 目的: ハードコードされた日本語文言を一箇所にまとめ、文言の一貫性 (同じ事象に対して
// 異なる文言が散らばらないこと) と将来の i18n 移行容易性を確保する。
//
// 設計方針:
//   - 単純な静的文字列はリテラル、引数依存のものは関数として公開する。
//   - 失敗トーストの body はエラー詳細を末尾に括弧書きで足すことが多いため、
//     `(reason: string) => string` 形式の関数を提供する。
//   - 1 箇所だけで使われる文言まで網羅する必要はなく、`重複している` または
//     `他レイヤと共通させたい` ものから順次集約する。
//
// 参照可レイヤ: 全レイヤから参照可 (utils は最下層)。
export const MESSAGES = {
  // Loop 4 UX-06: ロード中・ロード失敗・空状態の汎用文言を集約。
  // 各ページで散在していた「読み込み中…」「データの読み込みに失敗しました」「データがありません」を
  // 1 箇所で揃え、揺れ (例: "読込中" / "読み込み中" / "Loading…") を防ぐ。
  loading: "読み込み中…",
  loadError: "読み込みに失敗しました",
  empty: "データがありません",
  // L4 D-I18N-1 / Loop 6 D-I18N-2: 各ページに散らばっていたハードコード UI 文言を集約。
  //   1 文言 1 場所利用でも、将来の i18n 移行時にここを差替えるだけで済むよう先回り集約する。
  //   各キーは「画面・コンポーネント-用途」が判別できる名前にする (重複は許容しない)。
  ui: {
    // HomePage: STELLA 接続関連
    stellaCheckingConnection: "StellaRecord との接続を確認しています…",
    stellaCheckHint: "StellaRecord がインストールされていることを確認してください。",
    stellaReconnect: "再接続",
    stellaReconnecting: "接続中…",
    // HomePage: 週ナビ / 詳細ビュー
    backToWeek: "← 週に戻る",
    thisWeek: "今週",
    todayHeading: "今日",
    laneFootHint: "✦ 日付ヘッダーをクリックすると詳細が開きます ✦",
    zoomHint: "Shift + ホイールで拡縮",
    memoEmptyPick: "日付を選んでください",
    memoEmptyHint: "メモが表示されます",
    memoLoadFailed: "メモの読み込みに失敗しました",
    memoPlaceholder: "今日のことを書き留める…",
    memoSaveFailedTitle: "メモの保存に失敗しました",
    weekRangeSuffix: "の週",
    // Loop 6 D-I18N-2: 各種ボタン/汎用ラベル
    actionCancel: "キャンセル",
    actionOk: "OK",
    actionClose: "閉じる",
    actionAdd: "追加",
    actionUpdate: "更新",
    actionDelete: "削除",
    actionEdit: "編集",
    // confirmDialog overlay の aria-label。dialog のタイプ識別子なので「確認」固定。
    confirmDialogLabel: "確認",
    // 各種 close ボタンの aria-label。文脈別に短く統一する (a11y で対象物が文脈から
    // 明らかな場合は単に「閉じる」、複数モーダル並列時の識別が必要な場合は対象名を冠する)。
    closeReminder: "リマインダーを閉じる",
    closeModal: "モーダルを閉じる",
    // Settings: StellaRecord 連携状態
    integrationConnected: "接続済み",
    integrationDisconnected: "未接続",
    integrationUnregister: "連携を解除",
    integrationConfirmUnregister: "StellaRecord との連携を解除しますか？",
    // StartupReminder
    startupReminderTitle: "今日の予定",
  },
  // Loop 6 D-I18N-2: 入力欄プレースホルダ。
  //   placeholder 属性は a11y 翻訳対象になるため、メッセージとは別カテゴリで保持する。
  placeholders: {
    eventTitle: "予定のタイトル",
  },
  // Loop 6 D-I18N-2 / Loop 9: a11y のための入力要素 aria-label を集約。
  //   placeholder 文言とは別軸で「対象が何の入力か」を明示する固定ラベル群。
  //   重複させない (同じ意味のラベルは 1 キーに統合する) ことで揺れを防ぐ。
  ariaLabels: {
    eventTitle: "予定のタイトル",
    eventStartTime: "開始時刻",
    eventDate: "日付",
    eventReminder: "リマインダー",
  },
  review: {
    seenFailedTitle: "レビューの既読化に失敗しました",
    seenFailedBody: (reason: string): string =>
      `次回起動時に再表示される可能性があります (${reason})`,
    fetchFailedTitle: "レビューの取得に失敗しました",
    fetchFailedBody: (reason: string): string => `次回起動時に再試行されます (${reason})`,
    annualShownTitle: "年間レビューを表示しました",
    annualQ4HintBody: "閉じた後、次回起動時に前年 Q4 のスナップショットが届きます。",
  },
  // Loop 6 D-I18N-2: 失敗系トースト文言を集約。
  //   全 toast の title は「[操作名]に失敗しました」過去形に統一 (Loop 4 UX-03 ルール準拠)。
  //   body は errMessage(err) を末尾に付ける運用のため、ここでは title のみ集約する。
  //   kind は呼出側で `error` を渡すこと (warn 系は別途 reminders で管理)。
  errors: {
    stellaUnavailable: "StellaRecord に接続できません",
    // Settings
    voiceCharSaveFailed: "話者設定の保存に失敗しました",
    remindDefaultSaveFailed: "通知タイミングの保存に失敗しました",
    integrationUnregisterFailed: "連携解除に失敗しました",
    fontSaveFailed: "書体設定の保存に失敗しました",
    settingSaveFailed: "設定の保存に失敗しました",
    viewHourSaveFailed: "表示時刻の保存に失敗しました",
    viewHourRangeInvalidTitle: "表示時刻の範囲が不正です",
    viewHourRangeInvalidBody: "開始時刻は終了時刻より前にしてください。",
    // HomePage
    markerAddFailed: "マーカーの追加に失敗しました",
    markerRemoveFailed: "マーカーの削除に失敗しました",
    // CalendarPage
    eventAddFailed: "予定の追加に失敗しました",
    eventDeleteFailed: "予定の削除に失敗しました",
    eventUpdateFailed: "予定の更新に失敗しました",
    eventDateTimeRequired: "日付・時刻を入力してください",
    // app.ts 起動系
    unexpectedErrorTitle: "予期しないエラーが発生しました",
    unexpectedErrorBody: "詳細は開発者ツールのコンソールを確認してください。",
    stellaAutoRegisterFailedTitle: "StellaRecord への自動登録に失敗しました",
    stellaAutoRegisterFailedBody: (reason: string): string =>
      `設定画面から手動で再試行してください (${reason})`,
    // StartupReminder
    dismissNotificationFailedTitle: "通知の dismiss に失敗しました",
    dismissNotificationFailedBody: (title: string, reason: string): string =>
      `「${title}」は次回起動時に再表示される可能性があります (${reason})`,
  },
  // Loop 6 D-I18N-2: 警告 (warn) 系トーストの文言。
  //   ユーザー操作の入力を阻害しないが注意喚起を要するケース (過去日時の登録等)。
  warns: {
    eventPastAddTitle: "過去日時の予定として登録します",
    eventPastUpdateTitle: "過去日時で更新します",
    eventPastBody: "通知は行われません。内容を確認してください。",
    reminderFetchFailedTitle: "リマインダーの取得に失敗しました",
    reminderFetchFailedBody:
      "バックエンドの接続状況を確認してください。自動的にリトライを継続します。",
    reminderStoppedTitle: "リマインダー通知を停止しました",
    reminderStoppedBody: "バックエンドとの通信が長時間回復しません。アプリを再起動してください。",
  },
} as const;

// L4 R4-Err-8: バックエンド由来のエラーコード ↔ 表示文言のマッピングテーブル。
//   `errMessage()` から参照される single source of truth。
//   将来コード種別が増えたら `MESSAGES.errors` に対応文言を追加し、ここのテーブルに 1 行足す。
export const ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = {
  STELLA_UNAVAILABLE: MESSAGES.errors.stellaUnavailable,
} as const;
