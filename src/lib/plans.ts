import type { Tenant } from "@/db/schema";

const STARTER = ["pos", "batches", "expiry", "reorder", "export"] as const;
const PRO = [...STARTER, "prescriptions", "controlled", "analytics", "owner_summary", "supplier_ordering", "loyalty", "delivery", "claims", "ai"] as const;
const CHAIN = [...PRO, "multi_branch", "transfers", "consolidated", "api", "priority_support"] as const;

/** users: null = unlimited. Chain is priced per branch with a minimum of 3. */
export const PLANS = {
  starter: { name: "Starter", priceUsd: 15, users: 2 as number | null, branches: 1, features: STARTER as readonly string[] },
  pro: { name: "Pro", priceUsd: 29, users: 6 as number | null, branches: 1, features: PRO as readonly string[] },
  chain: { name: "Chain", priceUsd: 19, users: null as number | null, branches: 50, features: CHAIN as readonly string[], perBranch: true, minBranches: 3 },
} as const;
export type PlanKey = keyof typeof PLANS;
export type Feature = (typeof CHAIN)[number];

export const CHAIN_MIN_BRANCHES = 3;
export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 14; // unpaid -> read-only after this; data never locked

/** Trials get every feature so the pharmacy can judge the full product. */
export const hasFeature = (t: Pick<Tenant, "plan" | "planStatus">, f: Feature) =>
  t.planStatus === "trialing" || PLANS[t.plan].features.includes(f);

/** Branches billed on a plan: per-branch plans bill at least the minimum. */
export const billableBranches = (plan: PlanKey, activeBranches: number) =>
  plan === "chain" ? Math.max(CHAIN_MIN_BRANCHES, activeBranches) : 1;

/** Effective access: trial and paid accounts can write; unpaid beyond grace becomes read-only (export still allowed). */
export function accessLevel(t: Pick<Tenant, "planStatus" | "trialEndsAt" | "currentPeriodEnd">, now = new Date()): "full" | "read_only" {
  if (t.planStatus === "read_only" || t.planStatus === "cancelled") return "read_only";
  const end = t.planStatus === "trialing" ? t.trialEndsAt : (t.currentPeriodEnd ?? t.trialEndsAt);
  if (!end) return "full";
  const graceEnd = new Date(end.getTime() + (t.planStatus === "trialing" ? 0 : GRACE_DAYS) * 86400_000);
  return now > graceEnd ? "read_only" : "full";
}

/** Whole days left in the trial, or null when not trialing. */
export function trialDaysLeft(t: Pick<Tenant, "planStatus" | "trialEndsAt">, now = new Date()): number | null {
  if (t.planStatus !== "trialing" || !t.trialEndsAt) return null;
  return Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / 86400_000);
}
