import { and, asc, eq, gt, isNull, or, gte, sql, sum } from "drizzle-orm";
import type { Tx } from "@/db";
import { controlledRegister, products, stockBatches, stockMovements, type StockBatch } from "@/db/schema";
import { UserError } from "./action";
import { localDay } from "./format";
import { nextCounter } from "./numbers";
import { allocateFefo } from "./pos-math";

/**
 * The stock ledger. Every quantity change goes through `move()`, which updates the batch's cached qtyOnHand and writes a
 * stock_movements row in the same transaction; controlled drugs also get a controlled_register entry with the running
 * balance. Callers must run inside a transaction (tx()). Quantities are base units.
 */

/** Who is moving stock. `Ctx` from @/lib/auth satisfies this. */
export type StockActor = { tenant: { id: string; timezone: string }; user: { id: string } };
type MoveType = (typeof stockMovements.$inferInsert)["type"];

/** Extra detail the controlled-drug register needs for this movement. */
export type RegisterInfo = {
  partyName?: string | null; partyAddress?: string | null; prescriberName?: string | null; prescriberRegNo?: string | null;
  rxNo?: string | null; witnessName?: string | null; note?: string | null;
};

const REGISTER_KIND: Record<MoveType, string> = {
  receive: "received", sale: "supplied", sale_return: "returned_by_patient", supplier_return: "returned_to_supplier",
  expire: "destroyed", damage: "destroyed", adjust: "adjusted", stocktake: "adjusted", transfer_in: "transfer_in", transfer_out: "transfer_out",
};

export async function onHand(t: Tx, productId: string, branchId: string): Promise<number> {
  const [r] = await t.select({ n: sum(stockBatches.qtyOnHand).mapWith(Number) }).from(stockBatches)
    .where(and(eq(stockBatches.productId, productId), eq(stockBatches.branchId, branchId)));
  return r?.n ?? 0;
}

/** Applies a signed change to one batch and records it. The qty guard makes negative stock impossible. */
async function move(t: Tx, who: StockActor, o: {
  batch: Pick<StockBatch, "id" | "productId" | "branchId" | "unitCostMinor">; qty: number; type: MoveType;
  ref?: string | null; refId?: string | null; reason?: string | null; register?: RegisterInfo;
}) {
  if (!o.qty) return;
  const done = await t.update(stockBatches).set({ qtyOnHand: sql`${stockBatches.qtyOnHand} + ${o.qty}` })
    .where(and(eq(stockBatches.id, o.batch.id), gte(stockBatches.qtyOnHand, -o.qty))).returning({ id: stockBatches.id });
  if (!done.length) throw new UserError("Not enough stock in that batch");
  await t.insert(stockMovements).values({
    tenantId: who.tenant.id, userId: who.user.id, productId: o.batch.productId, batchId: o.batch.id, branchId: o.batch.branchId,
    qty: o.qty, type: o.type, unitCostMinor: o.batch.unitCostMinor, ref: o.ref ?? null, refId: o.refId ?? null, reason: o.reason ?? null,
  });
  const [p] = await t.select({ schedule: products.schedule }).from(products).where(eq(products.id, o.batch.productId));
  if (p?.schedule === "controlled") {
    const kind = REGISTER_KIND[o.type];
    if (kind === "destroyed" && !o.register?.witnessName) throw new UserError("Destroying a controlled drug needs a witness name for the register");
    const entryNo = await nextCounter(t, who.tenant.id, `cd:${o.batch.branchId}:${o.batch.productId}`);
    await t.insert(controlledRegister).values({
      tenantId: who.tenant.id, branchId: o.batch.branchId, productId: o.batch.productId, batchId: o.batch.id, entryNo, kind,
      qtyIn: Math.max(o.qty, 0), qtyOut: Math.max(-o.qty, 0), balance: await onHand(t, o.batch.productId, o.batch.branchId),
      partyName: o.register?.partyName ?? null, partyAddress: o.register?.partyAddress ?? null,
      prescriberName: o.register?.prescriberName ?? null, prescriberRegNo: o.register?.prescriberRegNo ?? null, rxNo: o.register?.rxNo ?? null,
      docRef: o.ref ?? null, enteredBy: who.user.id, witnessName: o.register?.witnessName ?? null, note: o.register?.note ?? o.reason ?? null,
    });
  }
}

/** Sellable batches of a product at a branch (in stock, unexpired, not quarantined), locked, in FEFO order. */
export async function lockSellableBatches(t: Tx, productId: string, branchId: string, today: string) {
  return t.select().from(stockBatches)
    .where(and(eq(stockBatches.productId, productId), eq(stockBatches.branchId, branchId), gt(stockBatches.qtyOnHand, 0),
      eq(stockBatches.quarantined, false), or(isNull(stockBatches.expiry), gte(stockBatches.expiry, today))))
    .orderBy(sql`${stockBatches.expiry} asc nulls last`, asc(stockBatches.receivedAt))
    .for("update");
}

/**
 * Takes `qty` base units out FEFO across batches. With allowShort (sales that already happened offline), the part the
 * books don't have is returned as `short` instead of failing; the caller records it and raises a discrepancy alert.
 */
export async function takeFefo(t: Tx, who: StockActor, o: {
  productId: string; branchId: string; qty: number; type: "sale" | "transfer_out" | "supplier_return";
  ref: string; refId?: string; productName?: string; allowShort?: boolean; register?: RegisterInfo;
}) {
  const today = localDay(who.tenant.timezone);
  const batches = await lockSellableBatches(t, o.productId, o.branchId, today);
  const { allocations, short } = allocateFefo(batches, o.qty, today);
  if (short > 0 && !o.allowShort) {
    throw new UserError(`Not enough stock of ${o.productName ?? "this item"}: ${o.qty - short} sellable at this branch`);
  }
  const out: { batchId: string; qty: number; unitCostMinor: number }[] = [];
  for (const a of allocations) {
    const b = batches.find((x) => x.id === a.batchId)!;
    await move(t, who, { batch: b, qty: -a.qty, type: o.type, ref: o.ref, refId: o.refId, register: o.register });
    out.push({ batchId: b.id, qty: a.qty, unitCostMinor: b.unitCostMinor });
  }
  return { allocations: out, short, costMinor: Math.round(out.reduce((s, a) => s + a.qty * a.unitCostMinor, 0)) };
}

/**
 * Adds stock to a batch, creating it when this product/branch/batch number/expiry is new. Receiving more of an existing
 * batch averages its unit cost.
 */
export async function receiveIntoBatch(t: Tx, who: StockActor, o: {
  productId: string; branchId: string; qty: number; batchNo?: string | null; expiry?: string | null; mfgDate?: string | null;
  unitCostMinor: number; supplierId?: string | null; receiptId?: string | null;
  type?: "receive" | "transfer_in" | "sale_return" | "stocktake"; ref?: string | null; refId?: string | null; reason?: string | null; register?: RegisterInfo;
}) {
  if (o.qty <= 0) throw new UserError("Quantity must be more than zero");
  const batchNo = (o.batchNo ?? "").trim().toUpperCase();
  const [existing] = await t.select().from(stockBatches).where(and(
    eq(stockBatches.productId, o.productId), eq(stockBatches.branchId, o.branchId), eq(stockBatches.batchNo, batchNo),
    o.expiry ? eq(stockBatches.expiry, o.expiry) : isNull(stockBatches.expiry),
  )).for("update").limit(1);
  let batch = existing;
  if (batch) {
    const total = batch.qtyOnHand + o.qty;
    const cost = total ? (batch.qtyOnHand * batch.unitCostMinor + o.qty * o.unitCostMinor) / total : o.unitCostMinor;
    if (o.type !== "sale_return" && o.type !== "stocktake") {
      [batch] = await t.update(stockBatches).set({ unitCostMinor: cost, supplierId: o.supplierId ?? batch.supplierId }).where(eq(stockBatches.id, batch.id)).returning();
    }
  } else {
    [batch] = await t.insert(stockBatches).values({
      tenantId: who.tenant.id, productId: o.productId, branchId: o.branchId, batchNo, expiry: o.expiry ?? null, mfgDate: o.mfgDate ?? null,
      qtyOnHand: 0, unitCostMinor: o.unitCostMinor, supplierId: o.supplierId ?? null, receiptId: o.receiptId ?? null,
    }).returning();
  }
  await move(t, who, { batch: { ...batch, unitCostMinor: o.unitCostMinor }, qty: o.qty, type: o.type ?? "receive", ref: o.ref, refId: o.refId, reason: o.reason, register: o.register });
  return batch;
}

/** Puts stock back into the exact batch it came from (customer returns, cancelled transfers). */
export async function returnToBatch(t: Tx, who: StockActor, o: { batchId: string; qty: number; type: "sale_return" | "transfer_in" | "adjust"; ref?: string | null; refId?: string | null; reason?: string | null; register?: RegisterInfo }) {
  const [b] = await t.select().from(stockBatches).where(eq(stockBatches.id, o.batchId)).for("update");
  if (!b) throw new UserError("Batch not found");
  await move(t, who, { batch: b, qty: o.qty, type: o.type, ref: o.ref, refId: o.refId, reason: o.reason, register: o.register });
  return b;
}

/** Signed change to one batch: count corrections, damage, expiry write-off, supplier return. Never below zero. */
export async function adjustBatch(t: Tx, who: StockActor, o: {
  batchId: string; delta: number; reason: string; type?: "adjust" | "expire" | "damage" | "supplier_return" | "stocktake" | "transfer_out";
  ref?: string | null; refId?: string | null; register?: RegisterInfo;
}) {
  if (!o.delta) throw new UserError("Enter a quantity");
  const [b] = await t.select().from(stockBatches).where(eq(stockBatches.id, o.batchId)).for("update");
  if (!b) throw new UserError("Batch not found");
  if (b.qtyOnHand + o.delta < 0) throw new UserError(`Only ${b.qtyOnHand} in this batch`);
  await move(t, who, { batch: b, qty: o.delta, type: o.type ?? "adjust", ref: o.ref, refId: o.refId, reason: o.reason, register: o.register });
  return b;
}
