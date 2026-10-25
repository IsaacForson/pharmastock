import { describe, expect, it } from "vitest";
import { buildReturnsCalendar, returnDeadline, type CalendarBatch } from "../returns-calendar";

describe("returnDeadline", () => {
  it("is expiry minus the supplier's minimum days to expiry", () => {
    expect(returnDeadline({ expiry: "2027-03-31", receivedDay: "2026-01-10" }, { returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 0 })).toBe("2026-12-31");
  });
  it("takes the earlier of the expiry rule and the delivery window", () => {
    expect(returnDeadline({ expiry: "2027-03-31", receivedDay: "2026-10-01" }, { returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 30 })).toBe("2026-10-31");
    expect(returnDeadline({ expiry: "2026-12-01", receivedDay: "2026-10-01" }, { returnMinDaysToExpiry: 60, returnWithinDaysOfDelivery: 365 })).toBe("2026-10-02");
  });
  it("uses the delivery window for items that don't expire, and null when there's no limit", () => {
    expect(returnDeadline({ expiry: null, receivedDay: "2026-10-01" }, { returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 14 })).toBe("2026-10-15");
    expect(returnDeadline({ expiry: null, receivedDay: "2026-10-01" }, { returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 0 })).toBeNull();
  });
});

const b = (o: Partial<CalendarBatch>): CalendarBatch => ({
  batchId: "b", productId: "p", productName: "Amoxicillin", batchNo: "A1", expiry: "2027-01-31", receivedDay: "2026-06-01", qty: 100,
  unitCostMinor: 12.5, supplierId: "s1", supplierName: "Kama", terms: { returnMinDaysToExpiry: 90, returnWithinDaysOfDelivery: 0 }, ...o,
});

describe("buildReturnsCalendar", () => {
  const today = "2026-10-25";
  it("groups by supplier, earliest deadline first, with value at cost", () => {
    const g = buildReturnsCalendar([
      b({ batchId: "1", expiry: "2027-06-30" }),
      b({ batchId: "2", expiry: "2027-01-31" }), // deadline 2026-11-02
      b({ batchId: "3", supplierId: "s2", supplierName: "Ernest Chemists", expiry: "2027-01-28", qty: 10, unitCostMinor: 100 }),
    ], today);
    expect(g.map((x) => x.supplierId)).toEqual(["s2", "s1"]);
    expect(g[1].entries.map((e) => e.batchId)).toEqual(["2", "1"]);
    expect(g[1].valueMinor).toBe(2500);
    expect(g[1].entries[0].daysLeft).toBe(8);
    expect(g[1].entries[0].urgency).toBe("soon");
    expect(g[0].entries[0].urgency).toBe("this_week");
  });
  it("leaves out missed deadlines and empty batches unless asked", () => {
    const rows = [b({ batchId: "x", expiry: "2026-12-01" }), b({ batchId: "y", qty: 0 })];
    expect(buildReturnsCalendar(rows, today)).toEqual([]);
    const all = buildReturnsCalendar(rows, today, { includeMissed: true });
    expect(all[0].entries.map((e) => [e.batchId, e.urgency])).toEqual([["x", "missed"]]);
  });
});
