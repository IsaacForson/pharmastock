import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  alerts, goodsReceiptLines, goodsReceipts, productUnits, products, purchaseOrderLines, purchaseOrders, stockBatches, supplierLinks,
  supplierPayments, supplierPrices, supplierReturnLines, supplierReturns, suppliers,
} from "@/db/schema";
import { UserError } from "./action";
import { audit, type Ctx } from "./auth";
import { randomToken, sha256 } from "./crypto";
import { emit } from "./events";
import { addDays, localDay, money } from "./format";
import { queueDirectMessage } from "./messaging";
import { nextNumber } from "./numbers";
import { adjustBatch, receiveIntoBatch } from "./stock";

/**
 * Purchasing domain: purchase orders, supplier portal confirmations, goods receipts (GRN), supplier returns and credit
 * notes, and accounts payable. Every function runs inside the caller's tenant transaction; stock only moves through
 * @/lib/stock.
 */

export const PO_OPEN = ["draft", "sent", "confirmed", "partially_received"] as const;
export const PORTAL_LINK_DAYS = 30;

// ---------- Pure maths ----------

/** Cost per base unit of a received line: what was paid spread over everything that arrived, free goods included. */
export function costPerBase(packCostMinor: number, qty: number, freeQty: number, factor: number) {
  const base = factor * (qty + freeQty);
  return base > 0 ? (packCostMinor * qty) / base : 0;
}

export const dueDate = (day: string, termsDays: number) => addDays(day, Math.max(0, termsDays));

export const BUCKETS = ["current", "1_30", "31_60", "61_90", "over_90"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<Bucket, string> = { current: "Not yet due", "1_30": "1–30 days late", "31_60": "31–60 days late", "61_90": "61–90 days late", over_90: "Over 90 days late" };

export function agingBucket(dueAt: string | null, today: string): Bucket {
  if (!dueAt || dueAt >= today) return "current";
  const late = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueAt}T00:00:00Z`)) / 86400_000);
  return late <= 30 ? "1_30" : late <= 60 ? "31_60" : late <= 90 ? "61_90" : "over_90";
}

/**
 * Pure: amount owed per aging bucket. `open` is each receipt's unpaid amount; `unallocatedMinor` (payments not tied to a
 * receipt, plus supplier credit notes) settles the oldest receipts first.
 */
export function aging(open: { dueAt: string | null; outstanding: number }[], unallocatedMinor: number, today: string) {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
  let credit = Math.max(0, unallocatedMinor);
  for (const r of [...open].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))) {
    const take = Math.min(credit, Math.max(0, r.outstanding));
    credit -= take;
    out[agingBucket(r.dueAt, today)] += r.outstanding - take;
  }
  const total = BUCKETS.reduce((s, b) => s + out[b], 0) - credit; // leftover credit = the supplier owes us
  return { buckets: out, total, overdue: BUCKETS.reduce((s, b) => s + (b === "current" ? 0 : out[b]), 0) };
}

/** Pure: spread a payment over open receipts, oldest due first; any excess is an advance (receiptId null). */
export function allocatePayment(open: { id: string; dueAt: string | null; outstanding: number }[], amountMinor: number) {
  const out: { receiptId: string | null; amountMinor: number }[] = [];
  let left = amountMinor;
  for (const r of [...open].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))) {
    if (left <= 0) break;
    const take = Math.min(left, r.outstanding);
    if (take > 0) { out.push({ receiptId: r.id, amountMinor: take }); left -= take; }
  }
  if (left > 0) out.push({ receiptId: null, amountMinor: left });
  return out;
}

// ---------- Purchase orders ----------

export const poLineInput = z.object({
  productId: z.string().uuid(), unitId: z.string().uuid(),
  qty: z.coerce.number().int().min(1, "Quantity must be at least 1").max(1_000_000),
  unitCostMinor: z.coerce.number().int().min(0).max(1_000_000_000),
});
export type PoLineInput = z.infer<typeof poLineInput>;

async function assertUnits(t: Tx, lines: { productId: string; unitId: string }[]) {
  if (!lines.length) throw new UserError("Add at least one product");
  const ids = [...new Set(lines.map((l) => l.unitId))];
  const units = await t.select({ id: productUnits.id, productId: productUnits.productId, factor: productUnits.factor, name: productUnits.name }).from(productUnits).where(inArray(productUnits.id, ids));
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const l of lines) if (byId.get(l.unitId)?.productId !== l.productId) throw new UserError("A pack size doesn't match its product. Reload and try again.");
  return byId;
}

async function getSupplier(t: Tx, id: string) {
  const [s] = await t.select().from(suppliers).where(eq(suppliers.id, id));
  if (!s) throw new UserError("Supplier not found");
  return s;
}

export async function createPurchaseOrder(t: Tx, ctx: Ctx, o: { supplierId: string; lines: PoLineInput[]; notes?: string | null; expectedAt?: string | null }) {
  await getSupplier(t, o.supplierId);
  await assertUnits(t, o.lines);
  const poNo = await nextNumber(t, ctx.tenant.id, "po");
  const [po] = await t.insert(purchaseOrders).values({
    tenantId: ctx.tenant.id, branchId: ctx.branchId, supplierId: o.supplierId, poNo, notes: o.notes ?? null, expectedAt: o.expectedAt ?? null,
    totalMinor: o.lines.reduce((s, l) => s + l.qty * l.unitCostMinor, 0), createdBy: ctx.user.id,
  }).returning();
  await t.insert(purchaseOrderLines).values(o.lines.map((l) => ({ tenantId: ctx.tenant.id, poId: po.id, ...l })));
  await audit(t, ctx, "create", "purchase_order", po.id, { details: { poNo, lines: o.lines.length } });
  return po;
}

async function getPo(t: Tx, poId: string) {
  const [po] = await t.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId)).for("update");
  if (!po) throw new UserError("Purchase order not found");
  return po;
}

/** Replaces a draft or sent order's lines (a sent order should be sent again afterwards). */
export async function updatePurchaseOrder(t: Tx, ctx: Ctx, poId: string, o: { supplierId: string; lines: PoLineInput[]; notes?: string | null; expectedAt?: string | null }) {
  const po = await getPo(t, poId);
  if (po.status !== "draft" && po.status !== "sent") throw new UserError("Only draft or sent orders can be edited");
  await getSupplier(t, o.supplierId);
  await assertUnits(t, o.lines);
  await t.delete(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  await t.insert(purchaseOrderLines).values(o.lines.map((l) => ({ tenantId: ctx.tenant.id, poId: po.id, ...l })));
  await t.update(purchaseOrders).set({
    supplierId: o.supplierId, notes: o.notes ?? null, expectedAt: o.expectedAt ?? null,
    totalMinor: o.lines.reduce((s, l) => s + l.qty * l.unitCostMinor, 0), confirmedAt: null, supplierNote: null,
  }).where(eq(purchaseOrders.id, po.id));
  await audit(t, ctx, "update", "purchase_order", po.id, { details: { lines: o.lines.length } });
}

/** One draft order per supplier from reorder lines. Returns the new orders. */
export async function createDraftPos(t: Tx, ctx: Ctx, lines: (PoLineInput & { supplierId: string })[]) {
  const bySupplier = new Map<string, PoLineInput[]>();
  for (const { supplierId, ...l } of lines) bySupplier.set(supplierId, [...(bySupplier.get(supplierId) ?? []), l]);
  const out = [];
  for (const [supplierId, ls] of bySupplier) out.push(await createPurchaseOrder(t, ctx, { supplierId, lines: ls }));
  return out;
}

/** New portal link for a supplier to view and confirm a PO. Only the hash is stored. */
export async function createSupplierLink(t: Tx, ctx: Ctx, o: { supplierId: string; poId: string }) {
  const token = randomToken();
  await t.insert(supplierLinks).values({ tenantId: ctx.tenant.id, supplierId: o.supplierId, poId: o.poId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + PORTAL_LINK_DAYS * 86400_000) });
  return token;
}

export const portalUrl = (token: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/s/${token}`;

/** Sends the PO to the supplier on WhatsApp or email with a portal link, and marks it sent. */
export async function sendPurchaseOrder(t: Tx, ctx: Ctx, poId: string, via: "whatsapp" | "email") {
  const po = await getPo(t, poId);
  if (!(["draft", "sent", "confirmed"] as string[]).includes(po.status)) throw new UserError("This order can no longer be sent");
  const s = await getSupplier(t, po.supplierId);
  const to = via === "email" ? s.email : s.phone;
  if (!to) throw new UserError(via === "email" ? "Add the supplier's email address first" : "Add the supplier's WhatsApp number first");
  const [{ n }] = await t.select({ n: sql<number>`count(*)::int` }).from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  if (!n) throw new UserError("Add at least one product before sending");
  const link = portalUrl(await createSupplierLink(t, ctx, { supplierId: s.id, poId: po.id }));
  await queueDirectMessage(t, {
    tenantId: ctx.tenant.id, to, channel: via, templateKey: "purchase_order", purpose: "purchase_order", supplierId: s.id,
    vars: { supplier: s.contactName || s.name, pharmacy: ctx.tenant.name, po: po.poNo, lines: n, amount: money(po.totalMinor, ctx.tenant.currency), link },
  });
  await t.update(purchaseOrders).set({ status: po.status === "draft" ? "sent" : po.status, sentAt: new Date(), sentVia: via }).where(eq(purchaseOrders.id, po.id));
  await emit(t, ctx.tenant.id, "purchase_order.sent", { id: po.id, poNo: po.poNo, supplierId: s.id, totalMinor: po.totalMinor, via });
  await audit(t, ctx, "send", "purchase_order", po.id, { details: { via, to } });
  return link;
}

export async function cancelPurchaseOrder(t: Tx, ctx: Ctx, poId: string) {
  const po = await getPo(t, poId);
  if (po.status === "received" || po.status === "cancelled") throw new UserError("This order is already closed");
  await t.update(purchaseOrders).set({ status: "cancelled" }).where(eq(purchaseOrders.id, po.id));
  await audit(t, ctx, "update", "purchase_order", po.id, { details: { status: "cancelled" } });
}

/** Supplier's answer from the portal: what it can supply and at what price, plus a note. Runs under the PO's tenant. */
export async function applySupplierConfirmation(t: Tx, o: { tenantId: string; poId: string; note?: string | null; lines: { lineId: string; supplierQty: number; supplierCostMinor: number }[] }) {
  const [po] = await t.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, o.poId), eq(purchaseOrders.tenantId, o.tenantId))).for("update");
  if (!po) throw new UserError("Order not found");
  if (po.status !== "sent" && po.status !== "confirmed") throw new UserError("This order can no longer be changed. Please contact the pharmacy.");
  const existing = await t.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  const ids = new Set(existing.map((l) => l.id));
  for (const l of o.lines) {
    if (!ids.has(l.lineId)) throw new UserError("This order changed. Reload the page.");
    await t.update(purchaseOrderLines).set({ supplierQty: l.supplierQty, supplierCostMinor: l.supplierCostMinor }).where(and(eq(purchaseOrderLines.id, l.lineId), eq(purchaseOrderLines.poId, po.id)));
  }
  await t.update(purchaseOrders).set({ status: "confirmed", confirmedAt: new Date(), supplierNote: o.note ?? null }).where(eq(purchaseOrders.id, po.id));
}

/** Pharmacy accepts the supplier's confirmed quantities and prices; zero-quantity lines are dropped. */
export async function acceptSupplierChanges(t: Tx, ctx: Ctx, poId: string) {
  const po = await getPo(t, poId);
  if (po.status !== "confirmed") throw new UserError("The supplier hasn't confirmed this order yet");
  const lines = await t.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id));
  let total = 0;
  for (const l of lines) {
    const qty = l.supplierQty ?? l.qty;
    const cost = l.supplierCostMinor ?? l.unitCostMinor;
    if (qty <= 0) { await t.delete(purchaseOrderLines).where(eq(purchaseOrderLines.id, l.id)); continue; }
    await t.update(purchaseOrderLines).set({ qty, unitCostMinor: cost }).where(eq(purchaseOrderLines.id, l.id));
    if (l.supplierCostMinor !== null) await upsertPrice(t, ctx.tenant.id, { supplierId: po.supplierId, productId: l.productId, unitId: l.unitId, costMinor: cost, source: "portal" });
    total += qty * cost;
  }
  await t.update(purchaseOrders).set({ totalMinor: total }).where(eq(purchaseOrders.id, po.id));
  await audit(t, ctx, "update", "purchase_order", po.id, { details: { acceptedSupplierChanges: true } });
}

async function upsertPrice(t: Tx, tenantId: string, o: { supplierId: string; productId: string; unitId: string; costMinor: number; source: string; supplierCode?: string | null }) {
  await t.insert(supplierPrices).values({ tenantId, ...o, updatedAt: new Date() }).onConflictDoUpdate({
    target: [supplierPrices.supplierId, supplierPrices.productId, supplierPrices.unitId],
    set: { costMinor: o.costMinor, source: o.source, updatedAt: new Date(), ...(o.supplierCode !== undefined ? { supplierCode: o.supplierCode } : {}) },
  });
}
export { upsertPrice as upsertSupplierPrice };

// ---------- Goods received notes ----------

export const grnLineInput = z.object({
  productId: z.string().uuid(), unitId: z.string().uuid(), poLineId: z.string().uuid().optional().nullable(),
  qty: z.coerce.number().int().min(0).max(1_000_000), freeQty: z.coerce.number().int().min(0).max(1_000_000).default(0),
  unitCostMinor: z.coerce.number().int().min(0).max(1_000_000_000),
  batchNo: z.string().trim().max(60).default(""),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  mfgDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
export type GrnLineInput = z.infer<typeof grnLineInput>;

export async function receiveGoods(t: Tx, ctx: Ctx, o: {
  supplierId?: string | null; poId?: string | null; supplierInvoiceNo?: string | null; dueAt?: string | null; notes?: string | null; lines: GrnLineInput[];
}) {
  const today = localDay(ctx.tenant.timezone);
  const lines = o.lines.filter((l) => l.qty + l.freeQty > 0);
  const units = await assertUnits(t, lines);
  const prods = await t.select({ id: products.id, name: products.name, schedule: products.schedule }).from(products).where(inArray(products.id, [...new Set(lines.map((l) => l.productId))]));
  const nameOf = (id: string) => prods.find((p) => p.id === id)?.name ?? "This product";
  for (const l of lines) {
    if (l.expiry && l.expiry < today) throw new UserError(`${nameOf(l.productId)} batch ${l.batchNo || "(no batch no.)"} is already expired. Don't receive it; return it to the supplier.`);
    if (l.mfgDate && l.expiry && l.mfgDate >= l.expiry) throw new UserError(`${nameOf(l.productId)}: manufacture date must be before expiry`);
    if (l.mfgDate && l.mfgDate > today) throw new UserError(`${nameOf(l.productId)}: manufacture date is in the future`);
  }
  let po: typeof purchaseOrders.$inferSelect | null = null;
  if (o.poId) {
    po = await getPo(t, o.poId);
    if (!(PO_OPEN as readonly string[]).includes(po.status)) throw new UserError("This order is closed");
    if (po.branchId !== ctx.branchId) throw new UserError("This order is for another branch. Switch branch to receive it.");
  }
  const supplierId = po?.supplierId ?? o.supplierId ?? null;
  const supplier = supplierId ? await getSupplier(t, supplierId) : null;
  const grnNo = await nextNumber(t, ctx.tenant.id, "grn");
  const totalMinor = lines.reduce((s, l) => s + l.qty * l.unitCostMinor, 0);
  const [grn] = await t.insert(goodsReceipts).values({
    tenantId: ctx.tenant.id, branchId: ctx.branchId, supplierId, poId: po?.id ?? null, grnNo, supplierInvoiceNo: o.supplierInvoiceNo ?? null,
    totalMinor, dueAt: o.dueAt ?? (supplier ? dueDate(today, supplier.paymentTermsDays) : null), notes: o.notes ?? null, receivedBy: ctx.user.id,
  }).returning();

  const poLines = po ? await t.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, po.id)) : [];
  for (const l of lines) {
    const factor = units.get(l.unitId)!.factor;
    const batch = await receiveIntoBatch(t, ctx, {
      productId: l.productId, branchId: ctx.branchId, qty: factor * (l.qty + l.freeQty), batchNo: l.batchNo, expiry: l.expiry ?? null, mfgDate: l.mfgDate ?? null,
      unitCostMinor: costPerBase(l.unitCostMinor, l.qty, l.freeQty, factor), supplierId, receiptId: grn.id, ref: grnNo, refId: grn.id,
      register: { partyName: supplier?.name ?? null, partyAddress: supplier?.address ?? null },
    });
    await t.insert(goodsReceiptLines).values({
      tenantId: ctx.tenant.id, receiptId: grn.id, productId: l.productId, unitId: l.unitId, qty: l.qty, freeQty: l.freeQty, unitCostMinor: l.unitCostMinor,
      batchNo: batch.batchNo, mfgDate: l.mfgDate ?? null, expiry: l.expiry ?? null, batchId: batch.id,
    });
    if (supplierId && l.qty > 0) await upsertPrice(t, ctx.tenant.id, { supplierId, productId: l.productId, unitId: l.unitId, costMinor: l.unitCostMinor, source: "receipt" });
    const pl = (l.poLineId && poLines.find((x) => x.id === l.poLineId)) || poLines.find((x) => x.productId === l.productId);
    if (pl) {
      pl.receivedBaseQty += factor * l.qty;
      await t.update(purchaseOrderLines).set({ receivedBaseQty: pl.receivedBaseQty }).where(eq(purchaseOrderLines.id, pl.id));
    }
  }
  if (po && poLines.length) {
    const lineFactors = await t.select({ id: productUnits.id, factor: productUnits.factor }).from(productUnits).where(inArray(productUnits.id, poLines.map((l) => l.unitId)));
    const f = new Map(lineFactors.map((u) => [u.id, u.factor]));
    const done = poLines.every((l) => l.receivedBaseQty >= l.qty * (f.get(l.unitId) ?? 1));
    await t.update(purchaseOrders).set({ status: done ? "received" : "partially_received" }).where(eq(purchaseOrders.id, po.id));
  }
  await emit(t, ctx.tenant.id, "stock.received", { id: grn.id, grnNo, supplierId, poId: po?.id ?? null, totalMinor, lines: lines.length });
  await audit(t, ctx, "create", "goods_receipt", grn.id, { details: { grnNo, lines: lines.length, totalMinor, poNo: po?.poNo } });
  return grn;
}

// ---------- Supplier returns ----------

export const RETURN_REASONS = { near_expiry: "Near expiry", expired: "Expired", damaged: "Damaged", recall: "Recall", wrong_item: "Wrong item", other: "Other" } as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export async function createSupplierReturn(t: Tx, ctx: Ctx, o: { supplierId?: string | null; reason: ReturnReason; notes?: string | null; lines: { batchId: string; qty: number }[] }) {
  const lines = o.lines.filter((l) => l.qty > 0);
  if (!lines.length) throw new UserError("Choose at least one batch and quantity to return");
  const batches = await t.select().from(stockBatches).where(inArray(stockBatches.id, lines.map((l) => l.batchId)));
  if (batches.length !== new Set(lines.map((l) => l.batchId)).size) throw new UserError("A batch was not found");
  if (batches.some((b) => b.branchId !== ctx.branchId)) throw new UserError("Return batches from the branch you're working at");
  const supplierId = o.supplierId ?? batches[0].supplierId;
  if (!supplierId) throw new UserError("Choose which supplier you're returning to");
  if (batches.some((b) => b.supplierId && b.supplierId !== supplierId)) throw new UserError("These batches came from different suppliers. Make one return per supplier.");
  const supplier = await getSupplier(t, supplierId);
  const returnNo = await nextNumber(t, ctx.tenant.id, "supplier_return");
  const [ret] = await t.insert(supplierReturns).values({
    tenantId: ctx.tenant.id, branchId: ctx.branchId, supplierId, returnNo, reason: o.reason, notes: o.notes ?? null, createdBy: ctx.user.id,
  }).returning();
  let value = 0;
  for (const l of lines) {
    const b = batches.find((x) => x.id === l.batchId)!;
    await adjustBatch(t, ctx, {
      batchId: b.id, delta: -l.qty, type: "supplier_return", reason: RETURN_REASONS[o.reason], ref: returnNo, refId: ret.id,
      register: { partyName: supplier.name, partyAddress: supplier.address, note: `Returned to supplier: ${RETURN_REASONS[o.reason]}` },
    });
    await t.insert(supplierReturnLines).values({ tenantId: ctx.tenant.id, returnId: ret.id, productId: b.productId, batchId: b.id, qty: l.qty, unitCostMinor: b.unitCostMinor });
    value += l.qty * b.unitCostMinor;
    if (b.qtyOnHand - l.qty === 0) {
      await t.update(alerts).set({ status: "done", resolution: "returned", resolvedBy: ctx.user.id, resolvedAt: new Date() })
        .where(and(eq(alerts.batchId, b.id), eq(alerts.status, "open")));
    }
  }
  await t.update(supplierReturns).set({ valueMinor: Math.round(value) }).where(eq(supplierReturns.id, ret.id));
  await emit(t, ctx.tenant.id, "stock.adjusted", { id: ret.id, type: "supplier_return", returnNo, supplierId, valueMinor: Math.round(value) });
  await audit(t, ctx, "adjust", "supplier_return", ret.id, { details: { returnNo, lines: lines.length, valueMinor: Math.round(value) } });
  return { ...ret, valueMinor: Math.round(value) };
}

/** Credit note from the supplier (or a rejection). Credited value reduces what the pharmacy owes that supplier. */
export async function recordCredit(t: Tx, ctx: Ctx, o: { returnId: string; creditNoteNo?: string | null; creditedMinor: number; rejected?: boolean }) {
  const [r] = await t.select().from(supplierReturns).where(eq(supplierReturns.id, o.returnId)).for("update");
  if (!r) throw new UserError("Return not found");
  const credited = o.rejected ? 0 : o.creditedMinor;
  if (!o.rejected && credited <= 0) throw new UserError("Enter the credited amount, or mark the return as rejected");
  const status = o.rejected ? "rejected" : credited >= r.valueMinor ? "credited" : "partially_credited";
  await t.update(supplierReturns).set({ status, creditNoteNo: o.creditNoteNo ?? null, creditedMinor: credited, creditedAt: new Date() }).where(eq(supplierReturns.id, r.id));
  await audit(t, ctx, "update", "supplier_return", r.id, { details: { status, creditedMinor: credited, creditNoteNo: o.creditNoteNo } });
  return status;
}

// ---------- Accounts payable ----------

export async function recordSupplierPayment(t: Tx, ctx: Ctx, o: {
  supplierId: string; amountMinor: number; method: (typeof supplierPayments.$inferInsert)["method"]; reference?: string | null; paidAt: string; receiptId?: string | null;
}) {
  if (o.amountMinor <= 0) throw new UserError("Enter an amount");
  await getSupplier(t, o.supplierId);
  const open = (await t.select({ id: goodsReceipts.id, dueAt: goodsReceipts.dueAt, total: goodsReceipts.totalMinor, paid: goodsReceipts.paidMinor })
    .from(goodsReceipts).where(and(eq(goodsReceipts.supplierId, o.supplierId), sql`${goodsReceipts.totalMinor} > ${goodsReceipts.paidMinor}`))
      .orderBy(goodsReceipts.receivedAt, goodsReceipts.grnNo).for("update")) // equal due dates: oldest delivery is paid first
    .map((r) => ({ id: r.id, dueAt: r.dueAt, outstanding: r.total - r.paid }));
  const target = o.receiptId ? open.filter((r) => r.id === o.receiptId) : open;
  if (o.receiptId && !target.length) throw new UserError("That delivery is already paid");
  const parts = allocatePayment(target, o.amountMinor);
  for (const p of parts) {
    await t.insert(supplierPayments).values({ tenantId: ctx.tenant.id, supplierId: o.supplierId, receiptId: p.receiptId, amountMinor: p.amountMinor, method: o.method, reference: o.reference ?? null, paidAt: o.paidAt, createdBy: ctx.user.id });
    if (p.receiptId) await t.update(goodsReceipts).set({ paidMinor: sql`${goodsReceipts.paidMinor} + ${p.amountMinor}` }).where(eq(goodsReceipts.id, p.receiptId));
  }
  await audit(t, ctx, "create", "supplier_payment", o.supplierId, { details: { amountMinor: o.amountMinor, method: o.method, reference: o.reference, parts: parts.length } });
}

export type SupplierBalance = { supplierId: string; owedMinor: number; overdueMinor: number; buckets: Record<Bucket, number>; nextDue: string | null };

/** What the pharmacy owes each supplier (all branches): receipts minus payments minus credit notes, with aging. */
export async function supplierBalances(t: Tx, today: string, supplierId?: string): Promise<Map<string, SupplierBalance>> {
  const recs = await t.select({ supplierId: goodsReceipts.supplierId, dueAt: goodsReceipts.dueAt, total: goodsReceipts.totalMinor, paid: goodsReceipts.paidMinor })
    .from(goodsReceipts).where(supplierId ? eq(goodsReceipts.supplierId, supplierId) : undefined);
  const adv = await t.select({ supplierId: supplierPayments.supplierId, n: sql<number>`sum(${supplierPayments.amountMinor})::int` })
    .from(supplierPayments).where(and(isNull(supplierPayments.receiptId), supplierId ? eq(supplierPayments.supplierId, supplierId) : undefined)).groupBy(supplierPayments.supplierId);
  const cred = await t.select({ supplierId: supplierReturns.supplierId, n: sql<number>`sum(${supplierReturns.creditedMinor})::int` })
    .from(supplierReturns).where(supplierId ? eq(supplierReturns.supplierId, supplierId) : undefined).groupBy(supplierReturns.supplierId);
  const ids = new Set([...recs.map((r) => r.supplierId), ...adv.map((r) => r.supplierId), ...cred.map((r) => r.supplierId)].filter(Boolean) as string[]);
  const out = new Map<string, SupplierBalance>();
  for (const id of ids) {
    const open = recs.filter((r) => r.supplierId === id && r.total > r.paid).map((r) => ({ dueAt: r.dueAt, outstanding: r.total - r.paid }));
    const unallocated = (adv.find((r) => r.supplierId === id)?.n ?? 0) + (cred.find((r) => r.supplierId === id)?.n ?? 0);
    const a = aging(open, unallocated, today);
    const nextDue = open.map((r) => r.dueAt).filter((d): d is string => !!d && d >= today).sort()[0] ?? null;
    out.set(id, { supplierId: id, owedMinor: a.total, overdueMinor: Math.max(0, a.overdue), buckets: a.buckets, nextDue });
  }
  return out;
}
