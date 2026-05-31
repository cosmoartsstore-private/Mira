import { describe, expect, test } from "vitest";
import { escapeHtml, errMessage } from "./html";

describe("escapeHtml", () => {
  test("escapes all five special characters", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  test("escapes ampersand first to avoid double-escaping", () => {
    // `<` を `&lt;` に変換した後にその `&` が再度エスケープされないことを保証する
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml("a < b & c")).toBe("a &lt; b &amp; c");
  });

  test("escapes a realistic attribute injection payload", () => {
    expect(escapeHtml("<img src=\"x\" onerror='alert(1)'>")).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;",
    );
  });

  test("leaves plain text untouched", () => {
    expect(escapeHtml("ぷらねっと わーるど")).toBe("ぷらねっと わーるど");
    expect(escapeHtml("")).toBe("");
  });
});

describe("errMessage", () => {
  test("returns Error.message for Error instances", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });

  test("returns the string itself for string input", () => {
    expect(errMessage("plain failure")).toBe("plain failure");
  });

  test("stringifies plain objects via JSON", () => {
    expect(errMessage({ code: 42 })).toBe('{"code":42}');
  });

  test("falls back to a sentinel for non-serializable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(errMessage(circular)).toBe("(unknown error)");
  });
});
