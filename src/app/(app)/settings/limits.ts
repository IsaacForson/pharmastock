import { and, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { branches, tenants, users, type Tenant } from "@/db/schema";
import { UserError } from "@/lib/action";
import { billableBranches, PLANS } from "@/lib/plans";

export type Seats = { users: number; branches: number };
type PlanOf = Pick<Tenant, "plan" | "planStatus">;

/** Effective limits: trials get the full product (Chain limits) so the pharmacy can judge everything. */
export function limitsFor(t: PlanOf) {
  const p = PLANS[t.planStatus === "trialing" ? "chain" : t.plan];
  return { users: p.users, branches: p.branches };
}

/** Why `next` doesn't fit the plan, or null if it does. Pass planStatus "active" to check a plan being bought. */
export function limitError(t: PlanOf, next: Seats): string | null {
  const name = PLANS[t.plan].name;
  const lim = limitsFor(t);
  if (lim.users !== null && next.users > lim.users) return `The ${name} plan allows ${lim.users} active staff accounts. Deactivate someone or upgrade.`;
  if (next.branches > lim.branches) return `The ${name} plan allows ${lim.branches} branch${lim.branches === 1 ? "" : "es"}. Upgrade to Chain for more branches.`;
  return null;
}

/** Current active seats, optionally ignoring one user (the one being edited). */
export async function currentSeats(t: Tx, tenantId: string, exceptUserId?: string): Promise<Seats> {
  const [u] = await t.select({ users: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.active, true), exceptUserId ? ne(users.id, exceptUserId) : undefined));
  const [b] = await t.select({ n: sql<number>`count(*)::int` }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.active, true)));
  return { users: u.users, branches: b.n };
}

/** Throws UserError if adding `add` to current seats exceeds the tenant's plan. */
export async function assertSeats(t: Tx, tenant: Pick<Tenant, "id"> & PlanOf, add: Partial<Seats>, exceptUserId?: string) {
  const cur = await currentSeats(t, tenant.id, exceptUserId);
  // Only complain about the dimension that grows, so an over-limit account can still edit unrelated things.
  const grown = { users: add.users ? cur.users + add.users : 0, branches: add.branches ? cur.branches + add.branches : 0 };
  const err = limitError(tenant, grown);
  if (err) throw new UserError(err);
}

/**
 * Keeps tenants.billedBranches equal to what the plan bills for the active branches (Chain: at least 3).
 * shortcut: a branch added mid-period is billed from the next renewal, not prorated; add proration if chains ask for it.
 */
export async function syncBilledBranches(t: Tx, tenant: Pick<Tenant, "id" | "plan">) {
  const { branches: n } = await currentSeats(t, tenant.id);
  const billed = billableBranches(tenant.plan, n);
  await t.update(tenants).set({ billedBranches: billed }).where(eq(tenants.id, tenant.id));
  return billed;
}
