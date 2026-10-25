import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant, type Tx } from "@/db";
import * as s from "@/db/schema";
import { audit, type Ctx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { createSale, returnSale, voidSale } from "@/lib/sales";
import { receiveIntoBatch } from "@/lib/stock";
import { resolvePeriod } from "../lib";
import { activity, overview, team, usage } from "../queries";

let ctx: Ctx, otherCtx: Ctx, cashier: s.User;
let para: { id: string; unit: string };
const T = <R,>(fn: (t: Tx) => Promise<R>) => withTenant(ctx.tenant.id, fn);
const filter = () => ({ branchIds: ctx.branches.map((b) => b.id), period: resolvePeriod("month", ctx.tenant.timezone) });
const line = (qty: number, extra: Record<string, number> = {}) => ({ productId: para.id, unitId: para.unit, qty, ...extra });

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Console Test Pharmacy", country: "GH", ownerName: "Owner", email: `console-${Date.now()}@test.local`, password: "correct horse battery" });
  const [main] = await adminDb().select().from(s.branches).where(eq(s.branches.tenantId, tenant.id));
  const [other] = await adminDb().insert(s.branches).values({ tenantId: tenant.id, name: "Other" }).returning();
  [cashier] = await adminDb().insert(s.users).values({ tenantId: tenant.id, name: "Cashier", role: "cashier", maxDiscountBp: 2000 }).returning();
  const branches = [{ id: main.id, name: main.name }, { id: other.id, name: "Other" }];
  ctx = { tenant, user: owner, branchId: main.id, sessionId: "x", branches, access: "full", ip: null, impersonatedBy: null };
  otherCtx = { ...ctx, branchId: other.id };
  const cashierCtx: Ctx = { ...ctx, user: cashier };

  await T(async (t) => {
    const [p] = await t.insert(s.products).values({ tenantId: tenant.id, name: "Paracetamol 500 mg", baseUnit: "tablet", taxBp: 0 }).returning();
    const [u] = await t.insert(s.productUnits).values({ tenantId: tenant.id, productId: p.id, name: "strip of 10", factor: 10, sellPriceMinor: 1000, isDefault: true }).returning();
    para = { id: p.id, unit: u.id };
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: main.id, qty: 200, batchNo: "A", expiry: "2030-01-01", unitCostMinor: 60 });
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: main.id, qty: 500, batchNo: "SOON", expiry: localDay(tenant.timezone).replace(/^(\d{4})-(\d{2})/, (_, y, m) => (m === "12" ? `${+y + 1}-01` : `${y}-${String(+m + 1).padStart(2, "0")}`)), unitCostMinor: 60 });
    await receiveIntoBatch(t, otherCtx, { productId: p.id, branchId: other.id, qty: 100, batchNo: "B", expiry: "2030-01-01", unitCostMinor: 60 });

    // Cashier: 2 strips with a 2.00 discount, 1 strip at an overridden price (offline, so it is honoured), then a voided sale.
    await createSale(t, cashierCtx, { clientId: "console-0001", lines: [line(2, { discountMinor: 200 })], payments: [{ method: "cash", amountMinor: 1800 }] } as never);
    await createSale(t, cashierCtx, { clientId: "console-0002", lines: [line(1, { unitPriceMinor: 900 })], payments: [{ method: "mobile_money", amountMinor: 900 }] } as never, { offline: true });
    const oops = await createSale(t, cashierCtx, { clientId: "console-0003", lines: [line(1)], payments: [{ method: "cash", amountMinor: 1000 }] } as never);
    await voidSale(t, ctx, { saleId: oops.id, reason: "Rang twice" });
    // Owner: one sale, then a return of one strip.
    const sale = await createSale(t, ctx, { clientId: "console-0004", lines: [line(3)], payments: [{ method: "cash", amountMinor: 3000 }] } as never);
    const [sl] = await t.select().from(s.saleLines).where(eq(s.saleLines.saleId, sale.id));
    await returnSale(t, ctx, { saleId: sale.id, reason: "Changed mind", restock: true, refundMethod: "cash", lines: [{ saleLineId: sl.id, baseQty: 10 }] });
    await createSale(t, otherCtx, { clientId: "console-0005", lines: [line(1)], payments: [{ method: "cash", amountMinor: 1000 }] } as never);
    await t.insert(s.expenses).values({ tenantId: tenant.id, branchId: main.id, category: "Rent", amountMinor: 500, day: localDay(tenant.timezone) });
    await audit(t, ctx, "update", "tenant", tenant.id);
  });
});

afterAll(async () => { await purgeTenant(ctx.tenant.id); });

describe("owner console overview", () => {
  it("sums sales without voids, takes refunds off and reports margin at batch cost", async () => {
    const d = await T((t) => overview(t, ctx, { ...filter(), branchIds: [ctx.branchId] }));
    expect(d.sales.n).toBe(3); // voided sale excluded
    expect(d.sales.revenue).toBe(1800 + 900 + 3000);
    expect(d.sales.cost).toBe((2 + 1 + 3) * 10 * 60);
    expect(d.sales.discounts).toBe(200);
    expect(d.sales.offline).toBe(1);
    expect(d.refunds).toMatchObject({ cur: 1000, voids: 1 });
    expect(d.expenses.cur).toBe(500);
    expect(d.stock.expiring).toBeGreaterThan(0);
    expect(d.months.revenue).toHaveLength(12);
    expect(d.months.revenue.at(-1)).toBe(5700);
    expect(d.mix.products[0]).toMatchObject({ label: "Paracetamol 500 mg", amount: 5700 });
  });

  it("respects the branch filter", async () => {
    const all = await T((t) => overview(t, ctx, filter()));
    expect(all.sales.revenue).toBe(6700);
    expect(all.mix.branches).toHaveLength(2);
    const one = await T((t) => overview(t, ctx, { ...filter(), branchIds: [otherCtx.branchId] }));
    expect(one.sales.revenue).toBe(1000);
  });

  it("holds staff accountable for discounts, voids, refunds and price changes", async () => {
    const rows = await T((t) => team(t, filter()));
    const c = rows.find((r) => r.id === cashier.id)!;
    expect(c).toMatchObject({ sales: 2, revenue: 2700, discounts: 200, discountedSales: 1, overrides: 1, voids: 0 });
    const o = rows.find((r) => r.id === ctx.user.id)!;
    expect(o).toMatchObject({ voids: 1, voidedValue: 1000, returns: 1, refunded: 1000 });
    expect(await T((t) => usage(t, ctx))).toMatchObject({ users: 2, branches: 2 });
  });

  it("feeds voids and returns to the activity log, leaving routine sales out by default", async () => {
    expect(await T((t) => activity(t, { type: "voids", userId: ctx.user.id, limit: 10, offset: 0 }))).toHaveLength(1);
    const feed = await T((t) => activity(t, { type: null, userId: null, limit: 50, offset: 0 }));
    expect(feed.some((r) => r.action === "return")).toBe(true);
    expect(feed.some((r) => r.entity === "tenant")).toBe(true);
    expect(feed.every((r) => !(r.action === "create" && r.entity === "sale"))).toBe(true);
  });
});
