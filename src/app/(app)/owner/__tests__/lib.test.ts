import { describe, expect, it } from "vitest";
import { delta, deltaPts, describeActivity, monthLabel, pickBranch, resolvePeriod, trendMonths, withQuery } from "../lib";

const now = new Date("2026-10-24T10:00:00Z");
const fmt = (m: number) => `GHS ${(m / 100).toFixed(2)}`;

describe("console periods", () => {
  it("compares month-to-date with the same days last month", () => {
    const p = resolvePeriod(undefined, "Africa/Accra", now);
    expect(p).toMatchObject({ key: "month", from: "2026-10-01", to: "2026-10-24", prevFrom: "2026-09-01", prevTo: "2026-09-24", days: 24 });
    expect(p.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
  it("clamps to the end of a shorter previous month", () => {
    expect(resolvePeriod("month", "UTC", new Date("2026-03-31T12:00:00Z"))).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    expect(resolvePeriod("ytd", "UTC", new Date("2028-02-29T12:00:00Z"))).toMatchObject({ from: "2028-01-01", prevFrom: "2027-01-01", prevTo: "2027-02-28" });
  });
  it("handles last month across a year boundary", () => {
    expect(resolvePeriod("last_month", "UTC", new Date("2026-01-15T12:00:00Z"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31", prevFrom: "2025-11-01", prevTo: "2025-11-30", days: 31 });
  });
  it("supports 90 days and year to date, and ignores junk", () => {
    expect(resolvePeriod("90d", "UTC", now)).toMatchObject({ from: "2026-07-27", to: "2026-10-24", prevFrom: "2026-04-28", prevTo: "2026-07-26", days: 90 });
    expect(resolvePeriod("ytd", "UTC", now)).toMatchObject({ from: "2026-01-01", prevFrom: "2025-01-01", prevTo: "2025-10-24" });
    expect(resolvePeriod("bogus", "UTC", now).key).toBe("month");
  });
  it("buckets today by pharmacy timezone", () => {
    const late = new Date("2026-10-31T22:30:00Z"); // already Nov 1 in Nairobi
    expect(resolvePeriod("month", "Africa/Nairobi", late).from).toBe("2026-11-01");
    expect(resolvePeriod("month", "Africa/Accra", late).from).toBe("2026-10-01");
  });
});

describe("trend months", () => {
  it("returns the 12 months ending with the period", () => {
    const t = trendMonths("2026-02-10");
    expect(t.months).toHaveLength(12);
    expect(t.months[0]).toBe("2025-03");
    expect(t.months.at(-1)).toBe("2026-02");
    expect(t).toMatchObject({ from: "2025-03-01", until: "2026-03-01" });
    expect(trendMonths("2026-12-31").until).toBe("2027-01-01");
    expect(monthLabel("2026-02")).toBe("Feb");
  });
});

describe("deltas", () => {
  it("formats percent change and knows when lower is better", () => {
    expect(delta(120, 100, "vs x")).toEqual({ value: "+20% vs x", good: true });
    expect(delta(80, 100, "vs x")).toEqual({ value: "-20% vs x", good: false });
    expect(delta(80, 100, "vs x", true)?.good).toBe(true);
    expect(delta(50, 0, "vs x")).toBeUndefined();
    expect(deltaPts(85, 82.5, "vs x")).toEqual({ value: "+2.5 pts vs x", good: true });
    expect(deltaPts(0, 0, "vs x")).toBeUndefined();
  });
});

describe("filters", () => {
  it("only accepts branches the user may see", () => {
    expect(pickBranch("b1", ["b1", "b2"])).toBe("b1");
    expect(pickBranch("b3", ["b1", "b2"])).toBeNull();
    expect(pickBranch(["b1"], ["b1"])).toBeNull();
  });
  it("builds query strings without empty values", () => {
    expect(withQuery("/owner", { period: "ytd", branch: null })).toBe("/owner?period=ytd");
    expect(withQuery("/owner", { period: "ytd" }, { period: null })).toBe("/owner");
  });
});

describe("activity sentences", () => {
  const row = (action: string, entity: string, details: unknown = null, customerNo: string | null = "C-000001") => ({ action, entity, details, userName: "Ama", customerNo });
  it("describes money-sensitive actions with amounts", () => {
    expect(describeActivity(row("void", "sale", { total: 5000, reason: "Wrong item" }), fmt))
      .toEqual({ text: "Ama voided a sale of GHS 50.00 for C-000001 — Wrong item", type: "voids" });
    expect(describeActivity(row("return", "sale", { returnNo: "RTN-000002", refund: 1000 }), fmt).text).toBe("Ama took a return RTN-000002, refunding GHS 10.00 for C-000001");
    expect(describeActivity(row("price_change", "product", { from: 1500, to: 1800 }, null), fmt)).toEqual({ text: "Ama changed a selling price from GHS 15.00 to GHS 18.00", type: "prices" });
    expect(describeActivity(row("create", "sale", { saleNo: "SL-000009", total: 2500, offline: true }), fmt).text).toBe("Ama sold SL-000009 for GHS 25.00 for C-000001 (offline)");
  });
  it("separates stock adjustments from the controlled-drug register", () => {
    expect(describeActivity(row("adjust", "stock_batch", { delta: -3, reason: "Broken bottle" }, null), fmt)).toEqual({ text: "Ama adjusted stock by -3 — Broken bottle", type: "stock" });
    expect(describeActivity(row("adjust", "stock_batch", { delta: 2, via: "register" }, null), fmt).type).toBe("controlled");
    expect(describeActivity(row("destroy", "stock_batch", { qty: 4, witness: "Kwame" }, null), fmt).text).toBe("Ama recorded destruction of a controlled drug (4 units), witnessed by Kwame");
  });
  it("flags PharmaStock support access", () => {
    expect(describeActivity(row("view", "customer", { impersonatedBy: "x", via: "pharmastock_support" }), fmt))
      .toEqual({ text: "PharmaStock support viewed a customer record for C-000001", type: "support" });
  });
  it("classifies logins, exports and setting changes", () => {
    expect(describeActivity(row("login", "user", { mfa: true }, null), fmt)).toEqual({ text: "Ama signed in with 2-step verification", type: "logins" });
    expect(describeActivity(row("export", "accounting", null, null), fmt)).toEqual({ text: "Ama exported accounting data", type: "exports" });
    expect(describeActivity(row("update", "tenant", null, null), fmt)).toEqual({ text: "Ama updated pharmacy settings", type: "settings" });
    expect(describeActivity(row("set_pin", "user", null, null), fmt)).toEqual({ text: "Ama set the counter PIN of a staff account", type: "settings" });
    expect(describeActivity(row("create", "customer"), fmt)).toEqual({ text: "Ama added customer C-000001", type: "customers" });
  });
});
