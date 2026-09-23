import { describe, expect, it } from "vitest";
import { ago, compact, duration, grouped, millis, percent, share, usd } from "./format";

describe("format", () => {
  it("compacts numbers like the Rust side", () => {
    expect(compact(null)).toBe("–");
    expect(compact(0)).toBe("0");
    expect(compact(999)).toBe("999");
    expect(compact(1000)).toBe("1K");
    expect(compact(1234)).toBe("1.2K");
    expect(compact(10_112_582)).toBe("10.1M");
    expect(compact(245_000_000)).toBe("245M");
    expect(compact(999_999)).toBe("1M");
    expect(compact(-1500)).toBe("-1.5K");
    expect(compact(Number.NaN)).toBe("–");
  });

  it("formats money, grouping and percent", () => {
    expect(usd(11.342)).toBe("$11.34");
    expect(usd(1234.5)).toBe("$1,235");
    expect(usd(-2.5)).toBe("-$2.50");
    expect(grouped(10_112_582)).toBe("10,112,582");
    expect(percent(3.587)).toBe("3.6%");
    expect(percent(null)).toBe("–");
  });

  it("formats durations", () => {
    expect(duration(45)).toBe("45s");
    expect(duration(18 * 60 + 5)).toBe("18m");
    expect(duration(3 * 3600 + 12 * 60)).toBe("3h 12m");
    expect(duration(270_991)).toBe("3d 3h");
    expect(duration(-1)).toBe("–");
    expect(millis(289.1)).toBe("289 ms");
    expect(millis(15_594.3)).toBe("15.6 s");
  });

  it("describes relative time", () => {
    const now = new Date("2026-09-23T17:15:00Z");
    expect(ago("2026-09-23T16:57:00Z", now)).toBe("18m ago");
    expect(ago("2026-09-23T17:14:55Z", now)).toBe("just now");
    expect(ago("garbage", now)).toBe("–");
  });

  it("computes safe shares", () => {
    expect(share(1, 4)).toBe(25);
    expect(share(5, 0)).toBe(0);
    expect(share(10, 5)).toBe(100);
  });
});
