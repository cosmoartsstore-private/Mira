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
