import { describe, expect, it } from "vitest";
import { convertMinor, monthlyPrice, nicePrice, priceListFor, subscriptionTotal, tenantMrrMinor } from "../money";

const rates = { USD: 1, GHS: 15.5, NGN: 1550 };

describe("money", () => {
  it("converts between currencies through USD", () => {
    expect(convertMinor(2900, "USD", "GHS", rates)).toBe(44950);
    expect(convertMinor(155000, "GHS", "NGN", rates)).toBe(15500000);
    expect(convertMinor(500, "GHS", "GHS", rates)).toBe(500);
    expect(() => convertMinor(100, "USD", "XYZ", rates)).toThrow(/No exchange rate/);
  });
  it("rounds to clean prices", () => {
    expect(nicePrice(79)).toBe(79);
    expect(nicePrice(449.5)).toBe(450);
    expect(nicePrice(1224.5)).toBe(1225);
    expect(nicePrice(44950)).toBe(45000);
  });
  it("builds a local price list, preferring custom prices", () => {
    const ghs = priceListFor("GHS", rates);
    expect(ghs.plans.pro).toBe(45000); // 29 × 15.5 = 449.5 → GHS 450.00
    expect(ghs.plans.starter).toBe(23500); // 15 × 15.5 = 232.5 → GHS 235.00
    expect(ghs.setup.basic).toBe(76000); // 49 × 15.5 = 759.5 → 760
    expect(ghs.custom).toBe(false);
    const custom = priceListFor("GHS", rates, { starter: 20000, pro: 40000, chainPerBranch: 27000, setupBasic: 1, setupStandard: 2, setupFull: 3 });
    expect(custom.plans.chain).toBe(27000);
    expect(custom.setup.full).toBe(3);
    expect(subscriptionTotal(custom, "pro", "annual", 1)).toBe(40000 * 10);
  });
  it("keeps USD list prices exact", () => {
    const usd = priceListFor("USD", rates);
    expect([usd.plans.starter, usd.plans.pro, usd.plans.chain]).toEqual([1500, 2900, 1900]);
    expect([usd.setup.basic, usd.setup.standard, usd.setup.full]).toEqual([4900, 9900, 14900]);
  });
  it("bills chain per branch with a minimum of 3", () => {
    const usd = priceListFor("USD", rates);
    expect(monthlyPrice(usd, "chain", 1)).toBe(5700);
    expect(monthlyPrice(usd, "chain", 7)).toBe(13300);
    expect(monthlyPrice(usd, "pro", 7)).toBe(2900); // single-branch plans ignore the count
  });
  it("computes MRR in the pharmacy's currency", () => {
    const ghs = priceListFor("GHS", rates);
    const t = { plan: "pro" as const, planStatus: "active", billingCycle: "annual", billedBranches: 1 };
    expect(tenantMrrMinor(ghs, t)).toBe(Math.round((45000 * 10) / 12));
    expect(tenantMrrMinor(ghs, { ...t, planStatus: "trialing" })).toBe(0);
    expect(tenantMrrMinor(ghs, { ...t, suspendedAt: new Date() })).toBe(0);
    expect(tenantMrrMinor(priceListFor("USD", rates), { plan: "chain", planStatus: "active", billingCycle: "monthly", billedBranches: 4 })).toBe(7600);
  });
});
