import { describe, expect, it } from "vitest";
import { suggestQty } from "../reorder";

const base = { onHand: 0, onOrder: 0, dailyDemand: 0, leadTimeDays: 3, coverDays: 21, reorderLevel: 0, reorderQty: 0, packFactor: 1 };

describe("suggestQty", () => {
  it("orders enough to cover lead time + cover days, in whole packs", () => {
    expect(suggestQty({ ...base, onHand: 20, dailyDemand: 5, packFactor: 100 })).toBe(100);
    expect(suggestQty({ ...base, onHand: 20, dailyDemand: 5, packFactor: 1 })).toBe(100);
  });
  it("counts open orders and orders nothing when covered", () => {
    expect(suggestQty({ ...base, onHand: 60, onOrder: 70, dailyDemand: 5 })).toBe(0);
  });
  it("respects reorder level and quantity for slow movers", () => {
    expect(suggestQty({ ...base, onHand: 2, reorderLevel: 5, reorderQty: 30 })).toBe(30);
    expect(suggestQty({ ...base, onHand: 6, reorderLevel: 5 })).toBe(0);
  });
  it("ignores products with no demand and no reorder level", () => {
    expect(suggestQty(base)).toBe(0);
  });
});
