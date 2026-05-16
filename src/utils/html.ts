// HTML 特殊文字をエスケープして innerHTML に安全に流す。
// `<` `>` `&` `"` `'` の 5 種を実体参照に置換し、属性値・テキストコンテンツの両方で利用可能。
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// `unknown` 例外を toast/ログで使える文字列に正規化する。
// Error なら `.message` を、その他は `String(...)` 経由でフォールバック。
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "(unknown error)";
  }
}
