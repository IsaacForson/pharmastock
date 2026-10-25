import { describe, expect, it } from "vitest";
import { allocateFefo, lineTotals, loyaltyEarned, saleTotals, spreadDiscount } from "../pos-math";

describe("lineTotals", () => {
  it("backs tax out of inclusive prices", () => {
    expect(lineTotals({ unitPriceMinor: 1200, qty: 1, taxBp: 2000 }, true)).toEqual({ grossMinor: 1200, discountMinor: 0, taxMinor: 200, totalMinor: 1200 });
  });
  it("adds tax on top of exclusive prices, after discount", () => {
    expect(lineTotals({ unitPriceMinor: 500, qty: 2, discountMinor: 100, taxBp: 1600 }, false)).toEqual({ grossMinor: 1000, discountMinor: 100, taxMinor: 144, totalMinor: 1044 });
  });
  it("never discounts below zero", () => {
    expect(lineTotals({ unitPriceMinor: 100, qty: 1, discountMinor: 500, taxBp: 0 }, true).totalMinor).toBe(0);
  });
});

describe("spreadDiscount", () => {
  it("splits exactly, largest remainder first", () => {
    const parts = spreadDiscount([333, 333, 334], 100);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([33, 33, 34]);
  });
  it("caps at the total", () => {
    expect(spreadDiscount([50, 50], 500)).toEqual([50, 50]);
  });
});

describe("saleTotals", () => {
  it("applies line then sale discount and sums tax per line", () => {
    const t = saleTotals([
      { key: "a", unitPriceMinor: 1000, qty: 1, taxBp: 0 },
      { key: "b", unitPriceMinor: 1000, qty: 1, discountMinor: 0, taxBp: 1500 },
    ], 200, true);
    expect(t.totalMinor).toBe(1800);
    expect(t.discountMinor).toBe(200);
    expect(t.lines[1].totalMinor).toBe(900);
    expect(t.taxMinor).toBe(Math.round((900 * 1500) / 11500));
  });
});

describe("allocateFefo", () => {
  const today = "2026-10-25";
  it("takes the earliest expiry first and skips expired, quarantined and empty batches", () => {
    const r = allocateFefo([
      { id: "late", qtyOnHand: 50, expiry: "2027-06-01" },
      { id: "expired", qtyOnHand: 50, expiry: "2026-10-24" },
      { id: "recalled", qtyOnHand: 50, expiry: "2026-11-01", quarantined: true },
      { id: "soon", qtyOnHand: 10, expiry: "2026-12-01" },
      { id: "noexp", qtyOnHand: 99, expiry: null },
      { id: "empty", qtyOnHand: 0, expiry: "2026-11-01" },
    ], 25, today);
    expect(r).toEqual({ allocations: [{ batchId: "soon", qty: 10 }, { batchId: "late", qty: 15 }], short: 0 });
  });
  it("sells on the expiry day itself and reports shortfalls", () => {
    const r = allocateFefo([{ id: "a", qtyOnHand: 3, expiry: today }], 5, today);
    expect(r).toEqual({ allocations: [{ batchId: "a", qty: 3 }], short: 2 });
  });
});

it("earns loyalty on whole major units paid", () => {
  expect(loyaltyEarned(1999, 1)).toBe(19);
  expect(loyaltyEarned(-5, 1)).toBe(0);
});
