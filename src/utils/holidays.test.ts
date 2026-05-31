import { describe, expect, test } from "vitest";
import { getJapaneseHolidays, type Holiday } from "./holidays";

// new Date(year, month-1, day) はローカル時刻で構築されるため、曜日計算はタイムゾーン非依存。

function has(holidays: Holiday[], day: number, name: string): boolean {
  return holidays.some((h) => h.day === day && h.name === name);
}

describe("getJapaneseHolidays", () => {
  test("includes fixed holidays for the month", () => {
    const may = getJapaneseHolidays(2024, 5);
    expect(has(may, 3, "憲法記念日")).toBe(true);
    expect(has(may, 4, "みどりの日")).toBe(true);
    expect(has(may, 5, "こどもの日")).toBe(true);
  });

  test("computes happy-monday holidays", () => {
    // 2025-01-01 は水曜のため、第 2 月曜は 1/13 (成人の日)
    const jan = getJapaneseHolidays(2025, 1);
    expect(has(jan, 1, "元日")).toBe(true);
    expect(has(jan, 13, "成人の日")).toBe(true);
  });

  test("adds a substitute holiday when a holiday falls on Sunday", () => {
    // 2024-05-05 (こどもの日) は日曜のため、5/6 が振替休日
    const may = getJapaneseHolidays(2024, 5);
    expect(has(may, 6, "振替休日")).toBe(true);
  });

  test("computes the vernal and autumnal equinox days", () => {
    expect(has(getJapaneseHolidays(2025, 3), 20, "春分の日")).toBe(true);
    expect(has(getJapaneseHolidays(2025, 9), 23, "秋分の日")).toBe(true);
  });

  test("switches Emperor's Birthday by era", () => {
    expect(has(getJapaneseHolidays(2018, 12), 23, "天皇誕生日")).toBe(true);
    expect(has(getJapaneseHolidays(2024, 2), 23, "天皇誕生日")).toBe(true);
    // 改元年 2019 は天皇誕生日なし
    expect(getJapaneseHolidays(2019, 12).some((h) => h.name === "天皇誕生日")).toBe(false);
  });

  test("returns holidays sorted by day", () => {
    const may = getJapaneseHolidays(2024, 5);
    const days = may.map((h) => h.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
});
