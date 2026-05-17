// ISO/SQL 日時文字列から "HH:MM" を抽出する (24 時間表記、ゼロ埋め)。
// 失敗時は空文字を返す。`new Date` が Invalid Date を返した場合も NaN チェックで弾く。
export function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ISO/SQL 日時文字列から「時 + 分/60」の小数で時刻を返す (0..24)。
// レーン縦座標計算用に秒も考慮する。失敗時は NaN を返すので呼び出し側で要判定。
export function parseHourFraction(isoStr: string): number {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return NaN;
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

// Loop 4 UX-05: 小数時刻 (14.5 など) を "HH:MM" 形式 (ゼロ埋め) に整形する。
// HomePage の旧 `formatHour` は "H:MM" 形式 (時間は無パディング) だったため、
// `formatTime` と挙動が揃わなかった。utils 側に集約して 24 時間表記を統一する。
// 24 以上は深夜越え扱いで 24 を引き 0..23 に丸める (繰り上げ後もゼロ埋め)。
export function formatHourMinute(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const display = h >= 24 ? h - 24 : h;
  return `${display.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// Loop 4 UX-10: Date を "M/D" 形式 (日本ロケールの短縮日付) で返す。
// CalendarPage / HomePage の `${month}/${day}` 直書きを集約するための共通関数。
export function formatDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// Loop 4 UX-10: Date を "YYYY年M月D日" 形式 (日本語長表記) で返す。
// レビューや見出し向けの正式表記用。
export function formatDateLong(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

// Loop 4 UX-10: 分数を「X時間Y分」(1 時間未満は「Y分」) の日本語形式で整形する。
// 旧 HomePage の `formatDuration` は英語表記 ("Xh Ym") だったが、Mira の UI 言語は日本語で
// 統一されているため utils 側で日本語表記に集約する。負値は 0 扱いとして "0分" を返す。
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0分";
  const total = Math.floor(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}時間${m}分`;
  if (h > 0) return `${h}時間`;
  return `${m}分`;
}

// L4 D-I18N-3: 数値を locale-aware に整形する (例: 1234 → "1,234")。
//
// 統一書式 (ja-JP) を default にしている理由:
//   - SnapshotModal / 統計表示など「数えやすさ」が要点の数値で 1000 区切りを統一する。
//   - Intl.NumberFormat はインスタンス化コストが比較的高いため、locale 固定の単一
//     インスタンスを module スコープで cache する (毎呼出 new しない)。
//   - 将来 locale 切替が必要になったら locale 引数を受ける overload を追加する。
const NUMBER_FORMAT_JP = new Intl.NumberFormat("ja-JP");
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return NUMBER_FORMAT_JP.format(n);
}

// L4 D-I18N-4: 文字列ソートを locale-aware (Intl.Collator) で行う。
//
// items 配列を破壊しない (新しい配列を返す) ことを明確にし、key で抽出した文字列を
// `Intl.Collator("ja-JP", { numeric: true, sensitivity: "base" })` で比較する。
//   - numeric: true  → "world10" が "world2" より後に来る (自然順)
//   - sensitivity: base → 大小文字や濁音記号の差を無視する (世界名/ユーザー名の意図的差は無視)
// Collator も毎回 new するとコストが高いため module scope で cache する。
const LOCALE_COLLATOR_JP = new Intl.Collator("ja-JP", {
  numeric: true,
  sensitivity: "base",
});
export function localeSort<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => LOCALE_COLLATOR_JP.compare(key(a), key(b)));
}
