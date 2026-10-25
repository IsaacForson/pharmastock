import { describe, expect, it } from "vitest";
import { platformCan } from "../platform-auth";
import { priceListFor } from "../money";
import { pharmacyMrr, type MoneyCtx } from "../platform-metrics";

describe("pharmacyMrr", () => {
  const rates = { USD: 1, GHS: 15.5, NGN: 1550 };
  const m: MoneyCtx = { display: "GHS", rates, lists: new Map([["USD", priceListFor("USD", rates)], ["GHS", priceListFor("GHS", rates)], ["NGN", priceListFor("NGN", rates)]]) };
  const base = { currency: "USD", plan: "pro" as const, planStatus: "active", billingCycle: "monthly", billedBranches: 1, suspendedAt: null };
  it("counts only active, unsuspended pharmacies", () => {
    expect(pharmacyMrr(m, base).local).toBe(2900);
    expect(pharmacyMrr(m, { ...base, planStatus: "trialing" }).local).toBe(0);
    expect(pharmacyMrr(m, { ...base, suspendedAt: new Date() }).local).toBe(0);
  });
  it("prices each pharmacy in its own currency and converts to the admin's", () => {
    const ng = pharmacyMrr(m, { ...base, currency: "NGN" });
    expect(ng.local).toBe(4500000); // 29 × 1550 = 44,950 → NGN 45,000 list price
    expect(ng.display).toBe(45000); // shown to a GHS admin as GHS 450
    expect(pharmacyMrr(m, { ...base, billingCycle: "annual" }).local).toBe(Math.round((2900 * 10) / 12));
  });
  it("bills chains per billed branch", () => {
    expect(pharmacyMrr(m, { ...base, plan: "chain", billedBranches: 5 }).local).toBe(1900 * 5);
    expect(pharmacyMrr(m, { ...base, plan: "chain", billedBranches: 2 }).local).toBe(1900 * 3);
  });
});

describe("platform roles", () => {
  it("limits destructive actions to super admins", () => {
    expect(platformCan("super_admin", "pharmacies.delete")).toBe(true);
    expect(platformCan("support", "pharmacies.delete")).toBe(false);
    expect(platformCan("finance", "pharmacies.suspend")).toBe(false);
    expect(platformCan("support", "pharmacies.impersonate")).toBe(true);
    expect(platformCan("finance", "revenue.view")).toBe(true);
    expect(platformCan("support", "revenue.view")).toBe(false);
    expect(platformCan("support", "team.manage")).toBe(false);
    expect(platformCan("support", "recalls.manage")).toBe(true);
    expect(platformCan("finance", "recalls.manage")).toBe(false);
  });
});
