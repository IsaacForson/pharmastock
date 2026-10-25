import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { branches, controlledRegister, goodsReceipts, messageLog, productUnits, products, purchaseOrderLines, purchaseOrders, stockBatches, supplierLinks, supplierPrices, suppliers } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { forecastDetails } from "@/lib/forecast";
import { addDays, localDay } from "@/lib/format";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import {
  acceptSupplierChanges, applySupplierConfirmation, createDraftPos, createSupplierReturn, receiveGoods, recordCredit, recordSupplierPayment,
  sendPurchaseOrder, supplierBalances,
} from "@/lib/purchasing";
import { buildReturnsCalendar, calendarBatches } from "@/lib/returns-calendar";
import { createSale } from "@/lib/sales";
import { onHand } from "@/lib/stock";

let ctx: Ctx;
let amox: { id: string; box: string };
let morph: { id: string; unit: string };
let sup: string, sup2: string;
const T = <R,>(fn: Parameters<typeof withTenant<R>>[1]) => withTenant(ctx.tenant.id, fn);

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Purchasing Test", country: "GH", ownerName: "Ama", email: `po-${Date.now()}@test.local`, password: "correct horse battery" });
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  await T(async (t) => {
    const [s] = await t.insert(suppliers).values({ tenantId: tenant.id, name: "Kama Pharma", phone: "+233200000001", paymentTermsDays: 30, returnMinDaysToExpiry: 90 }).returning();
    const [s2] = await t.insert(suppliers).values({ tenantId: tenant.id, name: "Ernest Chemists", email: "orders@ernest.test" }).returning();
    sup = s.id; sup2 = s2.id;
    const [p] = await t.insert(products).values({ tenantId: tenant.id, name: "Amoxicillin", strength: "500 mg", baseUnit: "capsule" }).returning();
    const [box] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: p.id, name: "box of 100", factor: 100 }).returning();
    amox = { id: p.id, box: box.id };
    const [m] = await t.insert(products).values({ tenantId: tenant.id, name: "Pethidine", schedule: "controlled", baseUnit: "ampoule" }).returning();
    const [mu] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: m.id, name: "box of 10", factor: 10 }).returning();
    morph = { id: m.id, unit: mu.id };
  });
});

afterAll(async () => { await purgeTenant(ctx.tenant.id); });

describe("purchase order → portal → GRN → return → payment", () => {
  let poId: string;

  it("creates one draft order per supplier", async () => {
    const pos = await T((t) => createDraftPos(t, ctx, [
      { supplierId: sup, productId: amox.id, unitId: amox.box, qty: 10, unitCostMinor: 5000 },
      { supplierId: sup, productId: morph.id, unitId: morph.unit, qty: 2, unitCostMinor: 3000 },
      { supplierId: sup2, productId: amox.id, unitId: amox.box, qty: 1, unitCostMinor: 5200 },
    ]));
    expect(pos).toHaveLength(2);
    poId = pos.find((p) => p.supplierId === sup)!.id;
    expect(pos.find((p) => p.id === poId)!.totalMinor).toBe(56000);
  });

  it("sends on WhatsApp with a portal link and the supplier confirms", async () => {
    const link = await T((t) => sendPurchaseOrder(t, ctx, poId, "whatsapp"));
    const token = link.split("/s/")[1];
    const [row] = await adminDb().select().from(supplierLinks).where(eq(supplierLinks.tokenHash, sha256(token)));
    expect(row.poId).toBe(poId);
    const [msg] = await T((t) => t.select().from(messageLog).where(eq(messageLog.supplierId, sup)));
    expect(msg.purpose).toBe("purchase_order");
    expect(msg.body).toContain(link);
    const [po] = await T((t) => t.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)));
    expect(po.status).toBe("sent");

    const lines = await T((t) => t.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId)));
    const amoxLine = lines.find((l) => l.productId === amox.id)!;
    const morphLine = lines.find((l) => l.productId === morph.id)!;
    await withTenant(row.tenantId, (t) => applySupplierConfirmation(t, { tenantId: row.tenantId, poId, note: "Only 8 boxes left", lines: [
      { lineId: amoxLine.id, supplierQty: 8, supplierCostMinor: 4800 }, { lineId: morphLine.id, supplierQty: 2, supplierCostMinor: 3000 },
    ] }));
    await T((t) => acceptSupplierChanges(t, ctx, poId));
    const [after] = await T((t) => t.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)));
    expect(after.status).toBe("confirmed");
    expect(after.totalMinor).toBe(8 * 4800 + 2 * 3000);
    const [price] = await T((t) => t.select().from(supplierPrices).where(eq(supplierPrices.productId, amox.id)));
    expect([price.costMinor, price.source]).toEqual([4800, "portal"]);
  });

  it("won't send on a channel the supplier has no contact for", async () => {
    const [p] = await T((t) => t.select().from(purchaseOrders).where(eq(purchaseOrders.supplierId, sup2)));
    await expect(T((t) => sendPurchaseOrder(t, ctx, p.id, "whatsapp"))).rejects.toThrow(/WhatsApp number/);
  });

  it("receives part of the order with free goods, blocks expired stock and writes the register", async () => {
    const today = localDay(ctx.tenant.timezone);
    const lines = await T((t) => t.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, poId)));
    const amoxLine = lines.find((l) => l.productId === amox.id)!;
    await expect(T((t) => receiveGoods(t, ctx, { poId, lines: [{ productId: amox.id, unitId: amox.box, qty: 1, freeQty: 0, unitCostMinor: 4800, batchNo: "OLD", expiry: addDays(today, -1) }] })))
      .rejects.toThrow(/already expired/);
    const grn = await T((t) => receiveGoods(t, ctx, { poId, supplierInvoiceNo: "INV-77", lines: [
      { productId: amox.id, unitId: amox.box, poLineId: amoxLine.id, qty: 4, freeQty: 1, unitCostMinor: 4800, batchNo: "am1", expiry: addDays(today, 120) },
    ] }));
    expect(grn.totalMinor).toBe(4 * 4800);
    expect(grn.dueAt).toBe(addDays(today, 30));
    expect(await T((t) => onHand(t, amox.id, ctx.branchId))).toBe(500);
    const [b] = await T((t) => t.select().from(stockBatches).where(eq(stockBatches.productId, amox.id)));
    expect(b.batchNo).toBe("AM1");
    expect(b.unitCostMinor).toBeCloseTo((4 * 4800) / 500);
    expect(b.supplierId).toBe(sup);
    let [po] = await T((t) => t.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)));
    expect(po.status).toBe("partially_received");

    await T((t) => receiveGoods(t, ctx, { poId, lines: [
      { productId: amox.id, unitId: amox.box, poLineId: amoxLine.id, qty: 4, freeQty: 0, unitCostMinor: 4800, batchNo: "AM2", expiry: addDays(today, 400) },
      { productId: morph.id, unitId: morph.unit, qty: 2, freeQty: 0, unitCostMinor: 3000, batchNo: "P1", expiry: addDays(today, 400) },
    ] }));
    [po] = await T((t) => t.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)));
    expect(po.status).toBe("received");
    const reg = await T((t) => t.select().from(controlledRegister).where(eq(controlledRegister.productId, morph.id)));
    expect(reg.map((r) => [r.kind, r.qtyIn, r.partyName])).toEqual([["received", 20, "Kama Pharma"]]);
  });

  it("lists the near-expiry batch on the returns calendar and returns it", async () => {
    const today = localDay(ctx.tenant.timezone);
    const cal = buildReturnsCalendar(await T((t) => calendarBatches(t, ctx.branchId, ctx.tenant.timezone)), today);
    const entry = cal[0].entries[0];
    expect(entry.batchNo).toBe("AM1");
    expect(entry.deadline).toBe(addDays(today, 30));
    const ret = await T((t) => createSupplierReturn(t, ctx, { reason: "near_expiry", lines: [{ batchId: entry.batchId, qty: 500 }] }));
    expect(ret.valueMinor).toBe(4 * 4800);
    expect(await T((t) => onHand(t, amox.id, ctx.branchId))).toBe(400);
    expect(await T((t) => recordCredit(t, ctx, { returnId: ret.id, creditNoteNo: "CN-1", creditedMinor: 10000 }))).toBe("partially_credited");
  });

  it("tracks what is owed: receipts minus payments minus credit notes", async () => {
    const today = localDay(ctx.tenant.timezone);
    let bal = (await T((t) => supplierBalances(t, today, sup))).get(sup)!;
    expect(bal.owedMinor).toBe(4 * 4800 + 4 * 4800 + 6000 - 10000);
    await T((t) => recordSupplierPayment(t, ctx, { supplierId: sup, amountMinor: 20000, method: "bank", paidAt: today }));
    bal = (await T((t) => supplierBalances(t, today, sup))).get(sup)!;
    expect(bal.owedMinor).toBe(44400 - 10000 - 20000);
    const grns = await T((t) => t.select().from(goodsReceipts).where(eq(goodsReceipts.supplierId, sup)).orderBy(goodsReceipts.grnNo));
    expect(grns[0].paidMinor).toBe(19200);
  });

  it("forecasts from sales: recent sales count, too little history means no factor for an uncategorised product", async () => {
    await T((t) => t.update(productUnits).set({ sellPriceMinor: 6000 }).where(eq(productUnits.id, amox.box)));
    await T((t) => createSale(t, ctx, { clientId: "po-test-sale-1", lines: [{ productId: amox.id, unitId: amox.box, qty: 1 }], payments: [{ method: "cash", amountMinor: 6000 }] } as never));
    const d = await T((t) => forecastDetails(t, ctx.tenant, ctx.branchId));
    const a = d.find((x) => x.productId === amox.id)!;
    expect(a.source).toBe("none");
    expect(a.last30Days).toBe(100);
  });
});
