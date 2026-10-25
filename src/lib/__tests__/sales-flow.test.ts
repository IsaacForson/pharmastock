import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { alerts, branches, controlledRegister, customers, prescriptions, productUnits, products, saleLines, sales, stockBatches, stockMovements } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { createSale, returnSale, voidSale } from "@/lib/sales";
import { onHand, receiveIntoBatch } from "@/lib/stock";

let ctx: Ctx;
let para: { id: string; unitTab: string; unitStrip: string };
let morphine: { id: string; unit: string };
let customerId: string;

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Flow Test Pharmacy", country: "GH", ownerName: "Ama", email: `flow-${Date.now()}@test.local`, password: "correct horse battery" });
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  await withTenant(tenant.id, async (t) => {
    const [p] = await t.insert(products).values({ tenantId: tenant.id, name: "Paracetamol", strength: "500 mg", baseUnit: "tablet", taxBp: 0 }).returning();
    const [tab] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: p.id, name: "tablet", factor: 1, sellPriceMinor: 20 }).returning();
    const [strip] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: p.id, name: "strip of 10", factor: 10, sellPriceMinor: 150, isDefault: true }).returning();
    para = { id: p.id, unitTab: tab.id, unitStrip: strip.id };
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: branch.id, qty: 30, batchNo: "late", expiry: "2028-01-01", unitCostMinor: 8 });
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: branch.id, qty: 15, batchNo: "soon", expiry: "2027-01-01", unitCostMinor: 10 });
    const [m] = await t.insert(products).values({ tenantId: tenant.id, name: "Morphine", strength: "10 mg", schedule: "controlled", baseUnit: "ampoule" }).returning();
    const [mu] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: m.id, name: "ampoule", factor: 1, sellPriceMinor: 1000 }).returning();
    morphine = { id: m.id, unit: mu.id };
    await receiveIntoBatch(t, ctx, { productId: m.id, branchId: branch.id, qty: 5, batchNo: "M1", expiry: "2027-06-01", unitCostMinor: 500 });
    const [c] = await t.insert(customers).values({ tenantId: tenant.id, customerNo: "C-1", name: "Kofi Mensah", creditLimitMinor: 10_000 }).returning();
    customerId = c.id;
  });
});

afterAll(async () => { await purgeTenant(ctx.tenant.id); });

describe("sale engine", () => {
  it("sells FEFO across batches, records cost and is idempotent on clientId", async () => {
    const input = { clientId: "till-1-sale-0001", lines: [{ productId: para.id, unitId: para.unitStrip, qty: 2 }], payments: [{ method: "cash" as const, amountMinor: 500 }] };
    const sale = await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, input as never));
    expect(sale.totalMinor).toBe(300);
    expect(sale.changeMinor).toBe(200);
    expect(sale.costMinor).toBe(15 * 10 + 5 * 8);
    const again = await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, input as never));
    expect(again.id).toBe(sale.id);
    const left = await withTenant(ctx.tenant.id, (t) => onHand(t, para.id, ctx.branchId));
    expect(left).toBe(25);
  });

  it("refuses more than the shelf has online, but records offline shortfalls", async () => {
    await expect(withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: "till-1-sale-0002", lines: [{ productId: para.id, unitId: para.unitTab, qty: 100 }], payments: [{ method: "cash", amountMinor: 2000 }] } as never)))
      .rejects.toThrow(/Not enough stock/);
    const s = await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: "till-1-sale-0003", lines: [{ productId: para.id, unitId: para.unitTab, qty: 30 }], payments: [{ method: "cash", amountMinor: 600 }] } as never, { offline: true }));
    expect(s.shortBaseQty).toBe(5);
    expect(await withTenant(ctx.tenant.id, (t) => onHand(t, para.id, ctx.branchId))).toBe(0);
  });

  it("flags offline sales that bypassed counter checks for review instead of trusting them", async () => {
    await withTenant(ctx.tenant.id, (t) => receiveIntoBatch(t, ctx, { productId: para.id, branchId: ctx.branchId, qty: 10, batchNo: "rev", expiry: "2029-06-01", unitCostMinor: 8 }));
    const cashier = { ...ctx, user: { ...ctx.user, role: "cashier" as const, maxDiscountBp: 500 } };
    const s = await withTenant(ctx.tenant.id, (t) => createSale(t, cashier, { clientId: "till-1-sale-0008", lines: [{ productId: para.id, unitId: para.unitTab, qty: 10, unitPriceMinor: 1 }], payments: [{ method: "cash", amountMinor: 10 }] } as never, { offline: true }));
    const [a] = await withTenant(ctx.tenant.id, (t) => t.select().from(alerts).where(eq(alerts.dedupeKey, `review:${s.id}`)));
    expect(a.kind).toBe("sale_review");
    expect(a.detail).toMatch(/instead of/);
  });

  it("needs a prescription for controlled drugs and writes the register with a running balance", async () => {
    await expect(withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: "till-1-sale-0004", customerId, lines: [{ productId: morphine.id, unitId: morphine.unit, qty: 1 }], payments: [{ method: "cash", amountMinor: 1000 }] } as never)))
      .rejects.toThrow(/needs a prescription/);
    const rxId = await withTenant(ctx.tenant.id, async (t) => {
      const [rx] = await t.insert(prescriptions).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, rxNo: "RX-1", customerId, prescriberName: "Dr Owusu", issuedOn: "2026-10-20" }).returning();
      return rx.id;
    });
    await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: "till-1-sale-0005", customerId, prescriptionId: rxId, lines: [{ productId: morphine.id, unitId: morphine.unit, qty: 2 }], payments: [{ method: "cash", amountMinor: 2000 }] } as never));
    const reg = await withTenant(ctx.tenant.id, (t) => t.select().from(controlledRegister).where(eq(controlledRegister.productId, morphine.id)).orderBy(controlledRegister.entryNo));
    expect(reg.map((r) => [r.kind, r.qtyIn, r.qtyOut, r.balance])).toEqual([["received", 5, 0, 5], ["supplied", 0, 2, 3]]);
    expect(reg[1].prescriberName).toBe("Dr Owusu");
    expect(reg[1].partyName).toBe("Kofi Mensah");
    await expect(withTenant(ctx.tenant.id, (t) => t.update(controlledRegister).set({ balance: 99 }).where(eq(controlledRegister.id, reg[0].id)))).rejects.toThrow();
  });

  it("sells on credit within the limit and returns into the original batch", async () => {
    await withTenant(ctx.tenant.id, (t) => receiveIntoBatch(t, ctx, { productId: para.id, branchId: ctx.branchId, qty: 20, batchNo: "new", expiry: "2029-01-01", unitCostMinor: 9 }));
    const sale = await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: "till-1-sale-0006", customerId, lines: [{ productId: para.id, unitId: para.unitStrip, qty: 1 }], creditMinor: 150 } as never));
    expect(sale.creditMinor).toBe(150);
    const [c] = await withTenant(ctx.tenant.id, (t) => t.select().from(customers).where(eq(customers.id, customerId)));
    expect(c.balanceMinor).toBe(150);
    const [line] = await withTenant(ctx.tenant.id, (t) => t.select().from(saleLines).where(eq(saleLines.saleId, sale.id)));
    const r = await withTenant(ctx.tenant.id, (t) => returnSale(t, ctx, { saleId: sale.id, lines: [{ saleLineId: line.id, baseQty: 4 }], reason: "Wrong item", restock: true, refundMethod: "credit" }));
    expect(r.refundMinor).toBe(60);
    const [b] = await withTenant(ctx.tenant.id, (t) => t.select().from(stockBatches).where(eq(stockBatches.id, line.allocations[0].batchId)));
    expect(b.qtyOnHand).toBe(14);
  });

  it("voids today's sale and puts everything back", async () => {
    const sale = await withTenant(ctx.tenant.id, (t) => createSale(t, ctx, { clientId: "till-1-sale-0007", lines: [{ productId: para.id, unitId: para.unitTab, qty: 3 }], payments: [{ method: "mobile_money", amountMinor: 60, reference: "MOMO123" }] } as never));
    const before = await withTenant(ctx.tenant.id, (t) => onHand(t, para.id, ctx.branchId));
    await withTenant(ctx.tenant.id, (t) => voidSale(t, ctx, { saleId: sale.id, reason: "Keyed twice" }));
    expect(await withTenant(ctx.tenant.id, (t) => onHand(t, para.id, ctx.branchId))).toBe(before + 3);
    const [v] = await withTenant(ctx.tenant.id, (t) => t.select().from(sales).where(eq(sales.id, sale.id)));
    expect(v.status).toBe("voided");
    const moves = await withTenant(ctx.tenant.id, (t) => t.select().from(stockMovements).where(eq(stockMovements.refId, sale.id)));
    expect(moves.reduce((s, m) => s + m.qty, 0)).toBe(0);
  });
});
