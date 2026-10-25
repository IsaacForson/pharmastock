import { describe, expect, it } from "vitest";
import { aging, agingBucket, allocatePayment, costPerBase, dueDate } from "../purchasing";

describe("costPerBase", () => {
  it("spreads the pack cost over everything that arrived, free goods included", () => {
    // 10 boxes of 100 at 50.00 each + 2 free boxes: 500000 / 1200 tablets
    expect(costPerBase(5000, 10, 2, 100)).toBeCloseTo(50000 / 1200);
    expect(costPerBase(5000, 10, 0, 100)).toBe(50);
    expect(costPerBase(5000, 0, 0, 100)).toBe(0);
  });
});

describe("aging", () => {
  const today = "2026-10-25";
  it("buckets by days past due", () => {
    expect(agingBucket(null, today)).toBe("current");
    expect(agingBucket("2026-10-25", today)).toBe("current");
    expect(agingBucket("2026-10-24", today)).toBe("1_30");
    expect(agingBucket("2026-08-20", today)).toBe("61_90");
    expect(agingBucket("2026-01-01", today)).toBe("over_90");
  });
  it("lets advances and credit notes settle the oldest first", () => {
    const a = aging([{ dueAt: "2026-11-30", outstanding: 1000 }, { dueAt: "2026-09-01", outstanding: 500 }], 300, today);
    expect(a.total).toBe(1200);
    expect(a.buckets["31_60"]).toBe(200);
    expect(a.buckets.current).toBe(1000);
    expect(a.overdue).toBe(200);
  });
  it("shows a negative balance when the supplier owes the pharmacy", () => {
    expect(aging([], 400, today).total).toBe(-400);
  });
  it("adds days to due dates", () => {
    expect(dueDate("2026-10-25", 30)).toBe("2026-11-24");
  });
});

describe("allocatePayment", () => {
  it("pays the oldest due first and keeps the excess as an advance", () => {
    expect(allocatePayment([{ id: "new", dueAt: "2026-12-01", outstanding: 500 }, { id: "old", dueAt: "2026-10-01", outstanding: 300 }], 1000))
      .toEqual([{ receiptId: "old", amountMinor: 300 }, { receiptId: "new", amountMinor: 500 }, { receiptId: null, amountMinor: 200 }]);
  });
});
