/**
 * Pure currency maths shared by server and client. Amounts are integer minor units (1/100 of the major unit) in every currency.
 * Rates are "units of currency per 1 USD".
 */
import { billableBranches, PLANS, type PlanKey } from "./plans";

/** Fallback rates used until the daily refresh (or an admin) sets real ones. Approximate; for display maths only. */
export const DEFAULT_PER_USD: Record<string, number> = {
  USD: 1, GHS: 15.5, NGN: 1550, KES: 129, UGX: 3700, TZS: 2700, RWF: 1420, ZAR: 18.2, ZMW: 26.5, XOF: 600, XAF: 600, GBP: 0.78,
};
export type Rates = Record<string, number>;

export function convertMinor(minor: number, from: string, to: string, rates: Rates): number {
  if (from === to) return minor;
  const f = rates[from] ?? DEFAULT_PER_USD[from], t = rates[to] ?? DEFAULT_PER_USD[to];
  if (!f || !t) throw new Error(`No exchange rate for ${from} or ${to}`);
  return Math.round((minor / f) * t);
}

/** Rounds a price (major units) to a clean figure customers expect: 79 → 79, 1224.5 → 1,225, 122,450 → 122,500. */
export function nicePrice(major: number): number {
  const step = major < 100 ? 1 : major < 1_000 ? 5 : major < 10_000 ? 25 : major < 100_000 ? 100 : major < 1_000_000 ? 500 : 1_000;
  return Math.ceil(major / step) * step;
}

/** One-time setup service: stock list import, barcode labelling session, staff training. */
export const SETUP_USD = { basic: 49, standard: 99, full: 149 } as const;
export type SetupKey = keyof typeof SETUP_USD;

/** plans.chain is the price per branch. */
export type PriceList = { currency: string; plans: Record<PlanKey, number>; setup: Record<SetupKey, number>; custom: boolean };

/** List prices in a currency (minor units), converted from USD and rounded, unless a custom row is given. */
export function priceListFor(currency: string, rates: Rates, custom?: { starter: number; pro: number; chainPerBranch: number; setupBasic: number; setupStandard: number; setupFull: number } | null): PriceList {
  if (custom) {
    return { currency, custom: true, plans: { starter: custom.starter, pro: custom.pro, chain: custom.chainPerBranch },
      setup: { basic: custom.setupBasic, standard: custom.setupStandard, full: custom.setupFull } };
  }
  // USD is the base list price: never rounded. Other currencies are converted, then rounded to a clean figure.
  const conv = (usd: number) => currency === "USD" ? usd * 100 : nicePrice(convertMinor(usd * 100, "USD", currency, rates) / 100) * 100;
  return {
    currency, custom: false,
    plans: { starter: conv(PLANS.starter.priceUsd), pro: conv(PLANS.pro.priceUsd), chain: conv(PLANS.chain.priceUsd) },
    setup: { basic: conv(SETUP_USD.basic), standard: conv(SETUP_USD.standard), full: conv(SETUP_USD.full) },
  };
}

/** Monthly price of a plan; chain is per billed branch (minimum 3). */
export const monthlyPrice = (list: PriceList, plan: PlanKey, branches: number) => list.plans[plan] * billableBranches(plan, branches);

/** Amount for a subscription checkout: monthly, or annual = 10 months (2 months free). */
export const subscriptionTotal = (list: PriceList, plan: PlanKey, cycle: "monthly" | "annual", branches: number) =>
  monthlyPrice(list, plan, branches) * (cycle === "annual" ? 10 : 1);

/** Monthly recurring value of a pharmacy in its own currency (annual spread over 12; non-paying = 0). */
export function tenantMrrMinor(list: PriceList, t: { plan: PlanKey; planStatus: string; billingCycle: string; billedBranches: number; suspendedAt?: Date | string | null }) {
  if (t.planStatus !== "active" || t.suspendedAt) return 0;
  const base = monthlyPrice(list, t.plan, t.billedBranches);
  return t.billingCycle === "annual" ? Math.round((base * 10) / 12) : base;
}

/** Currencies Paystack can charge. Others are billed in USD at the USD list price (shown with a local estimate). */
export const PAYSTACK_CURRENCIES = new Set(["GHS", "NGN", "KES", "ZAR", "USD", "XOF"]);
