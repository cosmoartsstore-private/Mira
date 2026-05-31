import { afterEach, describe, expect, test, vi } from "vitest";
import { Store, Subscriptions, getMonday } from "./store";

describe("Store", () => {
  test("get returns the initial value", () => {
    expect(new Store(42).get()).toBe(42);
  });

  test("set updates the value and notifies listeners with next/prev", () => {
    const store = new Store(1);
    const calls: [number, number][] = [];
    store.subscribe((next, prev) => calls.push([next, prev]));
    store.set(2);
    expect(store.get()).toBe(2);
    expect(calls).toEqual([[2, 1]]);
  });

  test("set skips notification when the value is reference-equal", () => {
    const store = new Store("a");
    const fn = vi.fn();
    store.subscribe(fn);
    store.set("a");
    expect(fn).not.toHaveBeenCalled();
  });

  test("unsubscribe stops further notifications", () => {
    const store = new Store(0);
    const fn = vi.fn();
    const unsub = store.subscribe(fn);
    store.set(1);
    unsub();
    store.set(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("subscribeImmediate fires once with the current value", () => {
    const store = new Store("x");
    const fn = vi.fn();
    store.subscribeImmediate(fn);
    expect(fn).toHaveBeenCalledExactlyOnceWith("x", "x");
  });

  test("a throwing listener does not block subsequent listeners", () => {
    const store = new Store(0);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const second = vi.fn();
    store.subscribe(() => {
      throw new Error("listener failure");
    });
    store.subscribe(second);
    store.set(1);
    expect(second).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("Subscriptions", () => {
  test("dispose calls every registered unsubscribe exactly once", () => {
    const subs = new Subscriptions();
    const a = vi.fn();
    const b = vi.fn();
    subs.add(a);
    subs.add(b);
    subs.dispose();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    // 二重 dispose で再呼び出しされない (リストがクリアされている)
    subs.dispose();
    expect(a).toHaveBeenCalledOnce();
  });
});

describe("getMonday", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns a YYYY-MM-DD string that is a Monday", () => {
    const result = getMonday();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [y, m, d] = result.split("-").map(Number);
    expect(new Date(y, m - 1, d).getDay()).toBe(1);
  });

  test("returns the same week's Monday for a mid-week date", () => {
    // 2026-05-31 は日曜 → 週始まりは 2026-05-25 (月)
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 31, 12, 0, 0));
    expect(getMonday()).toBe("2026-05-25");
  });
});
