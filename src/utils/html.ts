// HTML 特殊文字をエスケープして innerHTML に安全に流す。
// `<` `>` `&` `"` `'` の 5 種を実体参照に置換し、属性値・テキストコンテンツの両方で利用可能。
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
