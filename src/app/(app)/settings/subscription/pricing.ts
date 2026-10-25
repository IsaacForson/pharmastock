import { PLANS, type Feature, type PlanKey } from "@/lib/plans";

export type Cycle = "monthly" | "annual";

/** One-time setup service tiers (prices per currency come from the price book). */
export const SETUP_TIERS = {
  basic: { name: "Stock list import", detail: "We load your products, pack sizes, prices and opening stock from your Excel sheet or supplier price lists." },
  standard: { name: "Import + barcode labelling", detail: "Everything in the import, plus a session to scan existing barcodes and print labels for items without one." },
  full: { name: "Import, labels + staff training", detail: "Everything above, plus hands-on training for your counter staff and pharmacists on the till, receiving and stock takes." },
} as const;
export type SetupTier = keyof typeof SETUP_TIERS;

export const FEATURE_LABELS: Record<Feature, string> = {
  pos: "Till with scanning, FEFO and offline sales", batches: "Batch and expiry on every delivery", expiry: "Expiry alerts at 90, 60 and 30 days",
  reorder: "Reorder list from sales velocity", export: "Free full data export",
  prescriptions: "Prescriptions and refill reminders", controlled: "Controlled-drug register", analytics: "Margin, dead-stock and ABC analytics",
  owner_summary: "WhatsApp owner summary", supplier_ordering: "Supplier ordering and price comparison", loyalty: "Loyalty points",
  delivery: "Home delivery", claims: "Insurance / HMO claims", ai: "Ask PharmaStock (plain-language reports)",
  multi_branch: "Stock across branches", transfers: "Inter-branch transfers", consolidated: "Consolidated reports and central purchasing",
  api: "Public API and webhooks", priority_support: "Priority support",
};

const ORDER: PlanKey[] = ["starter", "pro", "chain"];

/** Features a plan adds over the plan below it, with the "Everything in X" lead-in. */
export function planHighlights(plan: PlanKey): { lead: string | null; features: string[] } {
  const i = ORDER.indexOf(plan);
  const below = i > 0 ? new Set(PLANS[ORDER[i - 1]].features) : new Set<string>();
  return {
    lead: i > 0 ? `Everything in ${PLANS[ORDER[i - 1]].name}, plus` : null,
    features: PLANS[plan].features.filter((f) => !below.has(f)).map((f) => FEATURE_LABELS[f as Feature]),
  };
}

/** "1 branch, 2 staff" style line for a plan card. */
export function planLimitsLine(plan: PlanKey) {
  const p = PLANS[plan];
  const staff = p.users === null ? "unlimited staff" : `${p.users} staff accounts`;
  return plan === "chain" ? `Per branch (minimum 3), ${staff}` : `${p.branches} branch, ${staff}`;
}
