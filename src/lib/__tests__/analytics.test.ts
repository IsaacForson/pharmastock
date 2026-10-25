import { describe, expect, it } from "vitest";
import { presetDays, resolveRange, toCsv } from "@/app/(app)/reports/range";
import { abcClassify, ageBalance, branchScope, buildJournal, deadStock, expiryTrend, priceImpact, suggestExpiryAction } from "@/lib/analytics";
import { expiryKind, expiryThreshold, recallMatches, returnDeadline } from "@/lib/alerts-engine";
import { formatOwnerSummary, type BranchDay } from "@/lib/owner-summary";

describe("ABC analysis", () => {
  it("splits by cumulative revenue 80/15/5 and puts non-sellers in C", () => {
    const out = abcClassify([{ id: "c", revenue: 50 }, { id: "a", revenue: 700 }, { id: "b", revenue: 150 }, { id: "d", revenue: 100 }, { id: "z", revenue: 0 }]);
    expect(out.map((r) => [r.id, r.abc])).toEqual([["a", "A"], ["b", "A"], ["d", "B"], ["c", "C"], ["z", "C"]]);
    expect(out[0].share).toBe(70);
    expect(out.at(-1)!.cumShare).toBe(100);
  });
});

describe("dead stock", () => {
  it("flags stocked items with no sales since the cutoff, ignoring fresh deliveries", () => {
    const cutoff = new Date("2026-07-01T00:00:00Z");
    const rows = [
      { id: "sold-recently", lastSoldAt: "2026-09-01T10:00:00Z", firstReceivedAt: "2026-01-01T00:00:00Z", onHand: 5, value: 100 },
      { id: "never-sold", lastSoldAt: null, firstReceivedAt: "2026-01-01T00:00:00Z", onHand: 5, value: 300 },
      { id: "stale", lastSoldAt: "2026-03-01T00:00:00Z", firstReceivedAt: "2026-01-01T00:00:00Z", onHand: 2, value: 500 },
      { id: "new-delivery", lastSoldAt: null, firstReceivedAt: "2026-10-01T00:00:00Z", onHand: 9, value: 900 },
      { id: "empty", lastSoldAt: null, firstReceivedAt: "2026-01-01T00:00:00Z", onHand: 0, value: 0 },
    ];
    expect(deadStock(rows, cutoff).map((r) => r.id)).toEqual(["stale", "never-sold"]);
  });
});

describe("price-change impact", () => {
  it("compares units/day and margin before and after", () => {
    const r = priceImpact({ units: 300, revenue: 30_000, cost: 15_000, days: 30 }, { units: 150, revenue: 18_000, cost: 7_500, days: 15 });
    expect(r).toMatchObject({ unitsPerDayBefore: 10, unitsPerDayAfter: 10, unitsChangePct: 0, marginPctBefore: 50, marginPctAfter: 58.3, marginPerDayBefore: 500, marginPerDayAfter: 700, marginPerDayChange: 200 });
    expect(priceImpact({ units: 0, revenue: 0, cost: 0, days: 0 }, { units: 5, revenue: 100, cost: 50, days: 5 }).unitsChangePct).toBeNull();
  });
});

describe("expiry losses", () => {
  it("measures each month against the baseline of the first months", () => {
    const r = expiryTrend([{ month: "2026-01", writeOff: 1000, cogs: 20_000 }, { month: "2026-02", writeOff: 800, cogs: 20_000 }, { month: "2026-03", writeOff: 1200, cogs: 20_000 }, { month: "2026-04", writeOff: 500, cogs: 25_000 }]);
    expect(r.baseline).toBe(1000);
    expect(r.rows.at(-1)).toMatchObject({ pctOfCogs: 2, vsBaseline: -50 });
  });
});

describe("credit aging", () => {
  it("attributes the balance to the newest charges first", () => {
    const charges = [{ amount: 500, day: "2026-06-01" }, { amount: 300, day: "2026-09-01" }, { amount: 200, day: "2026-10-20" }];
    expect(ageBalance(600, charges, "2026-10-25")).toEqual([200, 300, 0, 100]);
    expect(ageBalance(50, charges, "2026-10-25")).toEqual([50, 0, 0, 0]);
    expect(ageBalance(1200, charges, "2026-10-25")).toEqual([200, 300, 0, 700]); // 200 opening balance with no charge on record
  });
});

describe("branch scope", () => {
  const branches = [{ id: "a" }, { id: "b" }];
  it("lets chain owners and managers see all branches", () => {
    expect(branchScope({ role: "owner", consolidated: true, branches, current: "a", wanted: "all" })).toEqual({ ids: ["a", "b"], all: true, canAll: true });
    expect(branchScope({ role: "admin", consolidated: true, branches, current: "a", defaultAll: true }).all).toBe(true);
  });
  it("keeps everyone else to one allowed branch", () => {
    expect(branchScope({ role: "pharmacist", consolidated: true, branches, current: "a", wanted: "all" })).toEqual({ ids: ["a"], all: false, canAll: false });
    expect(branchScope({ role: "owner", consolidated: false, branches, current: "a", wanted: "all" }).ids).toEqual(["a"]);
    expect(branchScope({ role: "owner", consolidated: true, branches, current: "a", wanted: "b" }).ids).toEqual(["b"]);
    expect(branchScope({ role: "owner", consolidated: true, branches, current: "a", wanted: "someone-elses" }).ids).toEqual(["a"]);
  });
});

describe("accounting journal", () => {
  it("balances, including rounding on sales takings", () => {
    const rows = buildJournal({
      revenueByRate: [{ taxBp: 0, net: 10_000, tax: 0 }, { taxBp: 1500, net: 2_000, tax: 300 }],
      salePayments: [{ method: "cash", amount: 9_000 }, { method: "mobile_money", amount: 2_299 }], creditGiven: 1_000, payerPortion: 0,
      returns: [{ method: "cash", amount: 150 }], cogs: 7_000, receipts: 20_000, supplierReturns: 500,
      supplierPayments: [{ method: "bank", amount: 15_000 }], repayments: [{ method: "cash", amount: 400 }],
      expenses: [{ category: "Rent", method: "bank", amount: 5_000 }], writeOffs: 800, adjustments: -120,
    });
    const dr = rows.reduce((s, r) => s + r.debit, 0), cr = rows.reduce((s, r) => s + r.credit, 0);
    expect(dr).toBe(cr);
    expect(rows.find((r) => r.account === "Rounding and cash differences")).toMatchObject({ debit: 1, credit: 0 });
    expect(rows.find((r) => r.account === "Output tax payable")).toMatchObject({ credit: 300 });
    expect(rows.find((r) => r.account === "Stock count differences")).toMatchObject({ debit: 120 });
  });
});

describe("expiry suggestions and thresholds", () => {
  it("picks the tightest crossed threshold", () => {
    expect(expiryThreshold(100, [90, 60, 30])).toBeNull();
    expect(expiryThreshold(90, [90, 60, 30])).toBe(90);
    expect(expiryThreshold(45, [90, 60, 30])).toBe(60);
    expect(expiryThreshold(0, [90, 60, 30])).toBe(30);
    expect(expiryThreshold(-1, [90, 60, 30])).toBe(-1);
    expect([expiryKind(120), expiryKind(45), expiryKind(14), expiryKind(-1)]).toEqual(["expiry_90", "expiry_60", "expiry_30", "expired"]);
  });
  it("works out the supplier return deadline", () => {
    expect(returnDeadline({ expiry: "2027-03-01", receivedDay: "2026-10-01", minDaysToExpiry: 90, withinDaysOfDelivery: 0 })).toBe("2026-12-01");
    expect(returnDeadline({ expiry: "2027-03-01", receivedDay: "2026-10-01", minDaysToExpiry: 90, withinDaysOfDelivery: 30 })).toBe("2026-10-31");
    expect(returnDeadline({ expiry: "2026-11-01", receivedDay: "2026-10-01", minDaysToExpiry: 90, withinDaysOfDelivery: 0 })).toBeNull();
  });
  it("suggests return, transfer, discount or write-off", () => {
    expect(suggestExpiryAction({ daysLeft: 60, qty: 30, dailySales: 1, returnable: false }).action).toBe("discount"); // sells through
    expect(suggestExpiryAction({ daysLeft: 60, qty: 300, dailySales: 1, returnable: true }).action).toBe("return");
    expect(suggestExpiryAction({ daysLeft: 60, qty: 300, dailySales: 1, returnable: false, fasterBranch: { name: "Osu", dailySales: 4 } }).text).toMatch(/Transfer to Osu/);
    expect(suggestExpiryAction({ daysLeft: 20, qty: 300, dailySales: 1, returnable: false }).action).toBe("write_off");
    expect(suggestExpiryAction({ daysLeft: -2, qty: 3, dailySales: 1, returnable: true }).action).toBe("write_off");
  });
});

describe("recall matching", () => {
  const p = { name: "Panadol Extra", strength: "500 mg", genericName: "Paracetamol", manufacturer: "GSK Consumer Healthcare" };
  it("matches brand + batch, case and spacing insensitive", () => {
    expect(recallMatches({ productName: "PANADOL extra", genericName: null, manufacturer: "GSK", batchNos: ["ab 123"] }, p, "AB123")).toBe(true);
    expect(recallMatches({ productName: "Panadol Extra", genericName: null, manufacturer: null, batchNos: ["X1"] }, p, "AB123")).toBe(false);
    expect(recallMatches({ productName: "Panadol Extra", genericName: null, manufacturer: null, batchNos: [] }, p, "")).toBe(true);
  });
  it("rejects a contradicting manufacturer and needs more than a generic name", () => {
    expect(recallMatches({ productName: "Panadol Extra", genericName: null, manufacturer: "Emzor", batchNos: [] }, p, "AB123")).toBe(false);
    expect(recallMatches({ productName: "Some Brand", genericName: "paracetamol", manufacturer: null, batchNos: [] }, p, "AB123")).toBe(false);
    expect(recallMatches({ productName: "Some Brand", genericName: "paracetamol", manufacturer: "GSK", batchNos: [] }, p, "AB123")).toBe(true);
    expect(recallMatches({ productName: "Some Brand", genericName: "Paracetamol", manufacturer: null, batchNos: ["AB123"] }, p, "AB123")).toBe(true);
  });
});

describe("owner summary text", () => {
  const day = (o: Partial<BranchDay>): BranchDay => ({
    name: "Main", salesMinor: 0, count: 0, revenueExTaxMinor: 0, costMinor: 0, creditMinor: 0, payments: {}, nearExpiryMinor: 0, expiredMinor: 0,
    voids: { n: 0, minor: 0 }, returns: { n: 0, minor: 0 }, discrepancies: 0, ...o,
  });
  it("formats a single pharmacy", () => {
    const text = formatOwnerSummary({ pharmacy: "Ridge Pharmacy", dayLabel: "25 Oct 2026", currency: "USD", reorder: [{ name: "Amoxil 250 mg", packs: 3, unit: "box of 100" }],
      branches: [day({ salesMinor: 125_000, count: 42, revenueExTaxMinor: 120_000, costMinor: 84_000, creditMinor: 5_000, payments: { cash: 80_000, mobile_money: 40_000 }, nearExpiryMinor: 30_000 })] });
    expect(text).toBe([
      "*Ridge Pharmacy* · 25 Oct 2026", "Sales: $1,250.00 (42 sales)", "Gross margin: $360.00 (30%)", "Payments: Cash $800.00, MoMo $400.00",
      "Credit given: $50.00", "Near expiry (90 days): $300.00", "", "*Reorder*", "- Amoxil 250 mg: 3 × box of 100",
    ].join("\n"));
  });
  it("adds totals and a line per branch for chains", () => {
    const text = formatOwnerSummary({ pharmacy: "Chain", dayLabel: "25 Oct", currency: "USD", reorder: [],
      branches: [day({ name: "Osu", salesMinor: 10_000, count: 2, revenueExTaxMinor: 10_000, costMinor: 5_000, voids: { n: 1, minor: 500 } }), day({ name: "Tema", salesMinor: 30_000, count: 3, revenueExTaxMinor: 30_000, costMinor: 27_000, expiredMinor: 1_000 })] });
    expect(text).toContain("Sales: $400.00 (5 sales)");
    expect(text).toContain("Expired on shelf: $10.00");
    expect(text).toContain("Voids: 1 ($5.00) · Returns: 0 ($0.00)");
    expect(text).toContain("Osu: $100.00 · 2 sales · margin 50%");
    expect(text).toContain("Tema: $300.00 · 3 sales · margin 10%");
  });
});

describe("report ranges and CSV", () => {
  it("handles the 12-month and 90-day presets", () => {
    expect(presetDays("last12m", "2026-10-25")).toEqual(["2025-11-01", "2026-10-25"]);
    expect(presetDays("last12m", "2026-03-31")).toEqual(["2025-04-01", "2026-03-31"]);
    expect(presetDays("last90", "2026-10-25")[0]).toBe("2026-07-28");
    expect(resolveRange({ preset: "today" }, "Africa/Nairobi", new Date("2026-10-23T22:30:00Z"))).toMatchObject({ from: "2026-10-24" });
  });
  it("escapes CSV and neutralises formulas", () => {
    expect(toCsv(["a", "b"], [["=1+1", 'say "hi", ok']])).toBe('a,b\r\n\'=1+1,"say ""hi"", ok"\r\n');
  });
});
