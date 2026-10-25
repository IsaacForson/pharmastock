import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import * as schema from "@/db/schema";
import { priceListFor, subscriptionTotal } from "@/lib/money";
import { purgeTenant } from "@/lib/provision";
import { assertSeats, limitError, syncBilledBranches } from "../limits";

const active = (plan: "starter" | "pro" | "chain") => ({ plan, planStatus: "active" as const });

describe("plan limits", () => {
  it("checks users and branches per plan", () => {
    expect(limitError(active("starter"), { users: 2, branches: 1 })).toBeNull();
    expect(limitError(active("starter"), { users: 3, branches: 1 })).toMatch(/2 active staff/);
    expect(limitError(active("pro"), { users: 6, branches: 1 })).toBeNull();
    expect(limitError(active("pro"), { users: 1, branches: 2 })).toMatch(/Chain/);
    expect(limitError(active("chain"), { users: 40, branches: 8 })).toBeNull();
  });
  it("gives trials the full product", () => {
    expect(limitError({ plan: "pro", planStatus: "trialing" }, { users: 12, branches: 3 })).toBeNull();
  });
  it("prices annual as 10 months and chain per billed branch (minimum 3)", () => {
    const usd = priceListFor("USD", { USD: 1 });
    expect(subscriptionTotal(usd, "pro", "monthly", 1)).toBe(2900);
    expect(subscriptionTotal(usd, "pro", "annual", 1)).toBe(29000);
    expect(subscriptionTotal(usd, "chain", "monthly", 1)).toBe(1900 * 3);
    expect(subscriptionTotal(usd, "chain", "monthly", 5)).toBe(1900 * 5);
  });

  let tenantId: string;
  beforeAll(async () => {
    [{ id: tenantId }] = await adminDb().insert(schema.tenants).values({ name: "Limits", slug: `limits-${Date.now()}`, plan: "starter", planStatus: "active" }).returning({ id: schema.tenants.id });
    await adminDb().insert(schema.branches).values({ tenantId, name: "Main", isMain: true });
    await adminDb().insert(schema.users).values([
      { tenantId, name: "Owner", role: "owner" },
      { tenantId, name: "Gone", role: "cashier", active: false },
    ]);
  });
  afterAll(() => purgeTenant(tenantId));

  it("counts only active seats and only blocks the dimension that grows", async () => {
    const tenant = { id: tenantId, plan: "starter" as const, planStatus: "active" as const };
    await withTenant(tenantId, async (t) => {
      await expect(assertSeats(t, tenant, { users: 1 })).resolves.toBeUndefined(); // 2nd of 2 users; inactive one ignored
      await expect(assertSeats(t, tenant, { users: 2 })).rejects.toThrow(/staff/);
      await expect(assertSeats(t, tenant, { branches: 1 })).rejects.toThrow(/branch/);
    });
  });

  it("keeps billed branches in sync with active branches on Chain", async () => {
    await withTenant(tenantId, async (t) => {
      expect(await syncBilledBranches(t, { id: tenantId, plan: "chain" })).toBe(3); // 1 active, minimum 3
      await t.insert(schema.branches).values([1, 2, 3].map((i) => ({ tenantId, name: `B${i}` })));
      expect(await syncBilledBranches(t, { id: tenantId, plan: "chain" })).toBe(4);
      expect(await syncBilledBranches(t, { id: tenantId, plan: "pro" })).toBe(1);
    });
    const [row] = await adminDb().select({ b: schema.tenants.billedBranches }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    expect(row.b).toBe(1);
  });
});
