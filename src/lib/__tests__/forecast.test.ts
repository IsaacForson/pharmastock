import { describe, expect, it } from "vitest";
import { FACTOR_MAX, FACTOR_MIN, forecastMonth, historyFactor, marketHint, shiftMonth } from "../forecast";

/** 24 months of flat sales with an optional bump in one calendar month. */
function history(level: number, bump: Record<string, number> = {}, end = "2026-09", months = 24) {
  const out: Record<string, number> = {};
  for (let i = 0; i < months; i++) { const m = shiftMonth(end, -i); out[m] = bump[m.slice(5)] ?? level; }
  return out;
}

describe("shiftMonth", () => {
  it("crosses year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 3)).toBe("2027-02");
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
  });
});

describe("historyFactor", () => {
  it("is 1 for flat sales", () => {
    expect(historyFactor(history(100), "2026-10")).toBeCloseTo(1);
  });
  it("lifts demand when the same month last year was busy, smoothed", () => {
    const f = historyFactor(history(100, { "10": 200 }), "2026-10")!;
    expect(f).toBeGreaterThan(1.2);
    expect(f).toBeLessThan(1.6); // smoothed with neighbours and shrunk toward 1, not the raw 2x
  });
  it("lowers demand for a quiet month", () => {
    expect(historyFactor(history(100, { "10": 20 }), "2026-10")!).toBeLessThan(0.8);
  });
  it("is clamped", () => {
    expect(historyFactor(history(10, { "09": 1000, "10": 1000, "11": 1000 }), "2026-10")).toBe(FACTOR_MAX);
    expect(historyFactor(history(1000, { "09": 0, "10": 0, "11": 0 }), "2026-10")).toBe(FACTOR_MIN);
  });
  it("needs at least 13 months of history", () => {
    expect(historyFactor(history(100, {}, "2026-09", 12), "2026-10")).toBeNull();
    expect(historyFactor({}, "2026-10")).toBeNull();
  });
  it("needs sales in the trailing year", () => {
    const old: Record<string, number> = { "2024-01": 50, "2025-10": 0 };
    expect(historyFactor(old, "2026-10")).toBeNull();
  });
});

describe("marketHint", () => {
  it("raises antimalarials in Ghana's rainy season, not in the dry season", () => {
    expect(marketHint("GH", 6, "Antimalarials")?.factor).toBe(1.3);
    expect(marketHint("GH", 12, "Antimalarials")).toBeNull();
  });
  it("knows harmattan coughs and Kenyan cold season", () => {
    expect(marketHint("NG", 1, "Cough & cold")?.label).toMatch(/Harmattan/);
    expect(marketHint("KE", 7, "Cough & cold")?.factor).toBe(1.2);
  });
  it("ignores unknown countries and uncategorised products", () => {
    expect(marketHint("US", 6, "Antimalarials")).toBeNull();
    expect(marketHint("GH", 6, null)).toBeNull();
  });
});

describe("forecastMonth", () => {
  it("looks two weeks ahead", () => {
    expect(forecastMonth("2026-10-25")).toBe("2026-11");
    expect(forecastMonth("2026-10-01")).toBe("2026-10");
  });
});
