import { describe, expect, test } from "vitest";
import { formatTime, parseHourFraction } from "./datetime";

// タイムゾーン非依存にするため、`Z` やオフセットを付けない naive な日時文字列を使う
// (`new Date("2026-05-31T09:05:30")` はローカル時刻として解釈される)。

describe("formatTime", () => {
  test("formats hour and minute zero-padded", () => {
    expect(formatTime("2026-05-31T09:05:30")).toBe("09:05");
  });

  test("formats midnight as 00:00", () => {
    expect(formatTime("2026-01-01T00:00:00")).toBe("00:00");
  });

  test("returns empty string for invalid input", () => {
    expect(formatTime("")).toBe("");
    expect(formatTime("not a date")).toBe("");
  });
});

describe("parseHourFraction", () => {
  test("returns the hour with minute fraction", () => {
    expect(parseHourFraction("2026-05-31T09:30:00")).toBe(9.5);
  });

  test("accounts for seconds in the fraction", () => {
    expect(parseHourFraction("2026-05-31T06:00:36")).toBeCloseTo(6.01, 5);
  });

  test("returns NaN for invalid input", () => {
    expect(parseHourFraction("nope")).toBeNaN();
  });
});
