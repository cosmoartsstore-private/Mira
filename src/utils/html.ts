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
//
// L4 R4-Err-7: Tauri の `invoke` は失敗時に backend が返した値をそのまま reject に渡す。
//   Mira バックエンドは String 1 本で揃えているが、Tauri 内部や将来の
//   `Error<E>` ジェネリック移行で `{ code, message }` / `{ message }` 形式の
//   object が降ってくるケースがあるため、message プロパティを拾える分岐を追加する。
//   ネストせず単純な if 連鎖で分岐し、未知形式は最終 fallback の JSON.stringify に倒す。
//
// L4 R4-Err-8: バックエンドが返すエラーコード ("STELLA_UNAVAILABLE" 等) を
//   `ERROR_CODE_MESSAGES` でユーザー向け文言に置換する。
//   - 循環 import を避けるため messages.ts は値だけ import (型循環は起こらない)。
//   - 未マッピングコードはそのまま表示し、開発者が新しいコード追加に気付けるようにする。
import { ERROR_CODE_MESSAGES } from "./messages";

function mapErrorCode(raw: string): string {
  return ERROR_CODE_MESSAGES[raw] ?? raw;
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return mapErrorCode(e.message);
  if (typeof e === "string") return mapErrorCode(e);
  if (typeof e === "object" && e !== null) {
    // { message: "..." } / { code: "...", message: "..." } を message 優先で吸収。
    // `in` 演算子で narrowing 後は `e[key]` が `unknown` として参照できるため
    // 不要な type assertion を避けるためそのまま添字でアクセスする
    if ("message" in e) {
      const msg = e.message;
      if (typeof msg === "string") return mapErrorCode(msg);
      // message が string でないケースは (number 等) String 変換で救う
      return String(msg);
    }
    // code だけしか無い場合 (e.g. { code: "STELLA_UNAVAILABLE" }) はそれを返す
    if ("code" in e) {
      const code = e.code;
      if (typeof code === "string") return mapErrorCode(code);
    }
  }
  try {
    return JSON.stringify(e);
  } catch {
    return "(unknown error)";
  }
}
