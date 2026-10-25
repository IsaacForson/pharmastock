import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { branches, claims, customers, payers, payments, productUnits, products } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { awaitingClaim, claimableAmount, claimStatus, createClaim, itemStatus, settleClaimItem, submitClaim, toCsv } from "@/lib/claims";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { createSale } from "@/lib/sales";
import { receiveIntoBatch } from "@/lib/stock";
import { localDay } from "@/lib/format";

describe("claim maths", () => {
  it("claims only what the customer kept", () => {
    expect(claimableAmount({ totalMinor: 1000, payerPortionMinor: 800 }, 0)).toBe(800);
    expect(claimableAmount({ totalMinor: 1000, payerPortionMinor: 800 }, 250)).toBe(600);
    expect(claimableAmount({ totalMinor: 1000, payerPortionMinor: 800 }, 1000)).toBe(0);
  });
  it("derives item and batch status", () => {
    expect(itemStatus(500, 0, false)).toBe("pending");
    expect(itemStatus(500, 200, false)).toBe("partially_paid");
    expect(itemStatus(500, 500, false)).toBe("paid");
    expect(itemStatus(500, 0, true)).toBe("rejected");
    expect(claimStatus(false, [])).toBe("draft");
    expect(claimStatus(true, [{ status: "pending", amountPaidMinor: 0 }])).toBe("submitted");
    expect(claimStatus(true, [{ status: "paid", amountPaidMinor: 5 }, { status: "pending", amountPaidMinor: 0 }])).toBe("partially_paid");
    expect(claimStatus(true, [{ status: "paid", amountPaidMinor: 5 }, { status: "rejected", amountPaidMinor: 0 }])).toBe("paid");
    expect(claimStatus(true, [{ status: "rejected", amountPaidMinor: 0 }])).toBe("rejected");
  });
  it("quotes CSV cells", () => {
    expect(toCsv([["a", 'b "x"', "c,d", null]])).toBe('a,"b ""x""","c,d",\r\n');
  });
});

let ctx: Ctx;
let payerId: string, productId: string, unitId: string, customerId: string;

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Claims Test Pharmacy", country: "NG", ownerName: "Ada", email: `claims-${Date.now()}@test.local`, password: "correct horse battery" });
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  await withTenant(tenant.id, async (t) => {
    const [p] = await t.insert(products).values({ tenantId: tenant.id, name: "Coartem", baseUnit: "pack", taxBp: 0 }).returning();
    const [u] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: p.id, name: "pack", factor: 1, sellPriceMinor: 5000, isDefault: true }).returning();
    productId = p.id; unitId = u.id;
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: branch.id, qty: 20, batchNo: "C1", expiry: "2029-01-01", unitCostMinor: 3000 });
    const [py] = await t.insert(payers).values({ tenantId: tenant.id, name: "Hygeia HMO", kind: "hmo", coverageBp: 8000 }).returning();
    payerId = py.id;
    const [c] = await t.insert(customers).values({ tenantId: tenant.id, customerNo: "C-1", name: "Chidi", payerId: py.id, memberNo: "HY-1" }).returning();
    customerId = c.id;
  });
});
afterAll(async () => { await purgeTenant(ctx.tenant.id); });

describe("claim batches", () => {
  it("batches payer shares, settles partly and records insurance payments", async () => {
    for (const n of [1, 2]) {
      await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: `claim-sale-000${n}`, customerId, payerId, lines: [{ productId, unitId, qty: n }], payments: [{ method: "cash", amountMinor: 1000 * n }] } as never));
    }
    const waiting = await withTenant(ctx.tenant.id, (t) => awaitingClaim(t, ctx.tenant.timezone, { payerId }));
    expect(waiting.map((w) => w.claimable)).toEqual([4000, 8000]);
    const today = localDay(ctx.tenant.timezone);
    const claim = await withTenant(ctx.tenant.id, (t) => createClaim(t, ctx, { payerId, from: today, to: today }));
    expect(claim.totalClaimedMinor).toBe(12000);
    expect(await withTenant(ctx.tenant.id, (t) => awaitingClaim(t, ctx.tenant.timezone, { payerId }))).toHaveLength(0);
    await expect(withTenant(ctx.tenant.id, (t) => createClaim(t, ctx, { payerId, from: today, to: today }))).rejects.toThrow(/No sales/);

    const items = await withTenant(ctx.tenant.id, (t) => t.query.claimItems.findMany({ where: (i, { eq }) => eq(i.claimId, claim.id) }));
    await expect(withTenant(ctx.tenant.id, (t) => settleClaimItem(t, ctx, { itemId: items[0].id, paidMinor: 100 }))).rejects.toThrow(/Submit/);
    await withTenant(ctx.tenant.id, (t) => submitClaim(t, ctx, claim.id));
    const first = items.find((i) => i.amountClaimedMinor === 4000)!, second = items.find((i) => i.amountClaimedMinor === 8000)!;
    expect(await withTenant(ctx.tenant.id, (t) => settleClaimItem(t, ctx, { itemId: first.id, paidMinor: 4000 }))).toBe("paid");
    let [c] = await withTenant(ctx.tenant.id, (t) => t.select().from(claims).where(eq(claims.id, claim.id)));
    expect([c.status, c.totalPaidMinor]).toEqual(["partially_paid", 4000]);
    // Corrections are recorded as the difference.
    await withTenant(ctx.tenant.id, (t) => settleClaimItem(t, ctx, { itemId: first.id, paidMinor: 3500 }));
    await expect(withTenant(ctx.tenant.id, (t) => settleClaimItem(t, ctx, { itemId: second.id, paidMinor: 0, rejected: true }))).rejects.toThrow(/reason/);
    await withTenant(ctx.tenant.id, (t) => settleClaimItem(t, ctx, { itemId: second.id, paidMinor: 0, rejected: true, reason: "Not covered" }));
    [c] = await withTenant(ctx.tenant.id, (t) => t.select().from(claims).where(eq(claims.id, claim.id)));
    expect([c.status, c.totalPaidMinor]).toEqual(["partially_paid", 3500]);
    const ins = await withTenant(ctx.tenant.id, (t) => t.select().from(payments).where(eq(payments.method, "insurance")));
    expect(ins.reduce((s, p) => s + p.amountMinor, 0)).toBe(3500);
  });
});
