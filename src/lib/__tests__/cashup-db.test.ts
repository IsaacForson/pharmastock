import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { branches, customers, expenses, productUnits, products, saleLines } from "@/db/schema";
import { daySummary } from "@/app/(app)/cashup/data";
import { loadReceipt } from "@/app/(app)/sales/data";
import type { Ctx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { createSale, recordRepayment, returnSale, voidSale } from "@/lib/sales";
import { receiveIntoBatch } from "@/lib/stock";

let ctx: Ctx;
let productId: string, unitId: string, customerId: string;

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Close Test Pharmacy", country: "KE", ownerName: "Wanjiru", email: `close-${Date.now()}@test.local`, password: "correct horse battery" });
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  await withTenant(tenant.id, async (t) => {
    const [p] = await t.insert(products).values({ tenantId: tenant.id, name: "ORS", baseUnit: "sachet", taxBp: 0, schedule: "otc" }).returning();
    const [u] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: p.id, name: "sachet", factor: 1, sellPriceMinor: 1000, isDefault: true }).returning();
    productId = p.id; unitId = u.id;
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: branch.id, qty: 50, batchNo: "O1", expiry: "2029-01-01", unitCostMinor: 400 });
    const [c] = await t.insert(customers).values({ tenantId: tenant.id, customerNo: "C-1", name: "Otieno", creditLimitMinor: 100_000 }).returning();
    customerId = c.id;
  });
});
afterAll(async () => { await purgeTenant(ctx.tenant.id); });

describe("daily close from the books", () => {
  it("counts cash net of change, refunds, voids, repayments and cash expenses", async () => {
    const w = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ctx.tenant.id, fn);
    const a = await w((t) => createSale(t, ctx, { clientId: "close-sale-0001", lines: [{ productId, unitId, qty: 3 }], payments: [{ method: "cash", amountMinor: 5000 }] } as never));
    expect(a.changeMinor).toBe(2000);
    await w((t) => createSale(t, ctx, { clientId: "close-sale-0002", lines: [{ productId, unitId, qty: 2 }], payments: [{ method: "mobile_money", amountMinor: 2000, reference: "M-Pesa QX1" }] } as never));
    const v = await w((t) => createSale(t, ctx, { clientId: "close-sale-0003", lines: [{ productId, unitId, qty: 1 }], payments: [{ method: "cash", amountMinor: 1000 }] } as never));
    await w((t) => voidSale(t, ctx, { saleId: v.id, reason: "Rung twice" }));
    const cr = await w((t) => createSale(t, ctx, { clientId: "close-sale-0004", customerId, lines: [{ productId, unitId, qty: 4 }], creditMinor: 4000 } as never));
    await w((t) => recordRepayment(t, ctx, { customerId, amountMinor: 1500, method: "cash" }));
    const [line] = await w((t) => t.select().from(saleLines).where(eq(saleLines.saleId, a.id)));
    await w((t) => returnSale(t, ctx, { saleId: a.id, lines: [{ saleLineId: line.id, baseQty: 1 }], reason: "Changed mind", restock: true, refundMethod: "cash" }));
    const day = localDay(ctx.tenant.timezone);
    await w((t) => t.insert(expenses).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, category: "Transport", amountMinor: 300, method: "cash", day }));

    const s = await w((t) => daySummary(t, ctx.branchId, day, ctx.tenant.timezone));
    expect(s.takings.cash).toBe(3000 + 1500 - 1000); // sale A net of change, repayment, refund; void excluded
    expect(s.expected.cash).toBe(3500 - 300);
    expect(s.takings.mobile_money).toBe(2000);
    expect([s.salesCount, s.voidedCount, s.creditGiven, s.repaymentTotal]).toEqual([3, 1, 4000, 1500]);

    const r = await w((t) => loadReceipt(t, ctx.tenant, a.id));
    expect(r?.payments).toEqual([{ method: "cash", amountMinor: 5000, reference: null }]); // tendered, not net
    expect(r?.lines[0].batches[0]).toEqual({ batchNo: "O1", expiry: "2029-01-01" });
    expect(r?.link).toMatch(/\/r\/[0-9a-f]{32}\./);
    expect(cr.creditMinor).toBe(4000);
  });
});
