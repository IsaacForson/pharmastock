import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { productUnits, products, stockBatches, stockTakeLines, stockTakes } from "@/db/schema";
import { UserError } from "@/lib/action";
import type { Ctx } from "@/lib/auth";
import { audit } from "@/lib/auth";
import { emit } from "@/lib/events";
import { nextNumber } from "@/lib/numbers";
import { adjustBatch, receiveIntoBatch } from "@/lib/stock";

/** Stock take engine: start, record counts (expected snapshot at first count), variance, complete, cancel. */

export async function startTake(t: Tx, ctx: Ctx, o: { scope: "full" | "partial"; notes?: string | null }) {
  const takeNo = await nextNumber(t, ctx.tenant.id, "stocktake");
  const [take] = await t.insert(stockTakes).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, takeNo, scope: o.scope, notes: o.notes ?? null, startedBy: ctx.user.id }).returning();
  await audit(t, ctx, "create", "stock_take", take.id, { details: { takeNo, scope: o.scope } });
  return take;
}

/** Locks an open take at the user's branch (serialises concurrent counters). */
async function lockOpen(t: Tx, ctx: Ctx, takeId: string) {
  const [take] = await t.select().from(stockTakes).where(and(eq(stockTakes.id, takeId), eq(stockTakes.branchId, ctx.branchId))).for("update");
  if (!take) throw new UserError("Stock take not found at this branch");
  if (take.status !== "open") throw new UserError(`This stock take is already ${take.status}`);
  return take;
}

/**
 * Records a count in base units. Known batch: the expected quantity is snapshotted from the batch the first time it is
 * counted; recounts only change the counted quantity. Found stock (no batchId): matched to an existing batch with the same
 * batch no. + expiry when there is one, otherwise kept as a found line (expected 0) that becomes a new batch on completion.
 */
export async function recordCount(t: Tx, ctx: Ctx, takeId: string, o: { productId: string; batchId?: string | null; batchNo?: string | null; expiry?: string | null; countedQty: number }) {
  if (!Number.isInteger(o.countedQty) || o.countedQty < 0) throw new UserError("Count must be a whole number of 0 or more");
  await lockOpen(t, ctx, takeId);
  let batch = null as typeof stockBatches.$inferSelect | null;
  if (o.batchId) {
    [batch] = await t.select().from(stockBatches).where(and(eq(stockBatches.id, o.batchId), eq(stockBatches.branchId, ctx.branchId), eq(stockBatches.productId, o.productId)));
    if (!batch) throw new UserError("That batch isn't at this branch");
  } else {
    const batchNo = (o.batchNo ?? "").trim().toUpperCase();
    [batch] = await t.select().from(stockBatches).where(and(eq(stockBatches.productId, o.productId), eq(stockBatches.branchId, ctx.branchId), eq(stockBatches.batchNo, batchNo),
      o.expiry ? eq(stockBatches.expiry, o.expiry) : isNull(stockBatches.expiry))).limit(1);
    if (!batch) {
      const [p] = await t.select({ id: products.id }).from(products).where(eq(products.id, o.productId));
      if (!p) throw new UserError("Product not found");
      const [line] = await t.select().from(stockTakeLines).where(and(eq(stockTakeLines.takeId, takeId), eq(stockTakeLines.productId, o.productId), isNull(stockTakeLines.batchId),
        eq(stockTakeLines.batchNo, batchNo), o.expiry ? eq(stockTakeLines.expiry, o.expiry) : isNull(stockTakeLines.expiry)));
      if (line) {
        const [u] = await t.update(stockTakeLines).set({ countedQty: o.countedQty, countedBy: ctx.user.id, countedAt: new Date() }).where(eq(stockTakeLines.id, line.id)).returning();
        return u;
      }
      const [n] = await t.insert(stockTakeLines).values({ tenantId: ctx.tenant.id, takeId, productId: o.productId, batchId: null, batchNo, expiry: o.expiry ?? null, expectedQty: 0, countedQty: o.countedQty, countedBy: ctx.user.id }).returning();
      return n;
    }
  }
  const [line] = await t.select().from(stockTakeLines).where(and(eq(stockTakeLines.takeId, takeId), eq(stockTakeLines.batchId, batch.id)));
  if (line) {
    const [u] = await t.update(stockTakeLines).set({ countedQty: o.countedQty, countedBy: ctx.user.id, countedAt: new Date() }).where(eq(stockTakeLines.id, line.id)).returning();
    return u;
  }
  const [n] = await t.insert(stockTakeLines).values({
    tenantId: ctx.tenant.id, takeId, productId: batch.productId, batchId: batch.id, batchNo: batch.batchNo, expiry: batch.expiry,
    expectedQty: batch.qtyOnHand, countedQty: o.countedQty, countedBy: ctx.user.id,
  }).returning();
  return n;
}

export async function deleteLine(t: Tx, ctx: Ctx, takeId: string, lineId: string) {
  await lockOpen(t, ctx, takeId);
  await t.delete(stockTakeLines).where(and(eq(stockTakeLines.id, lineId), eq(stockTakeLines.takeId, takeId)));
}

/** Lines with variance (qty and value at batch cost) plus, for full takes, uncounted batches still holding stock. */
export async function varianceReport(t: Tx, takeId: string) {
  const [take] = await t.select().from(stockTakes).where(eq(stockTakes.id, takeId));
  if (!take) return null;
  const rows = await t.select({ line: stockTakeLines, name: products.name, strength: products.strength, baseUnit: products.baseUnit, cost: stockBatches.unitCostMinor })
    .from(stockTakeLines).innerJoin(products, eq(products.id, stockTakeLines.productId)).leftJoin(stockBatches, eq(stockBatches.id, stockTakeLines.batchId))
    .where(eq(stockTakeLines.takeId, takeId)).orderBy(products.name, stockTakeLines.expiry);
  // Found stock has no batch yet: value it at the product's latest batch cost at the branch.
  const lastCost = async (productId: string) => (await t.select({ c: stockBatches.unitCostMinor }).from(stockBatches)
    .where(and(eq(stockBatches.productId, productId), eq(stockBatches.branchId, take.branchId))).orderBy(desc(stockBatches.receivedAt), sql`${stockBatches.expiry} desc nulls last`).limit(1))[0]?.c ?? 0; // same-delivery batches tie on receivedAt: later expiry is the newer stock
  const lines = [];
  for (const r of rows) {
    const cost = r.cost ?? await lastCost(r.line.productId);
    const variance = r.line.countedQty - r.line.expectedQty;
    lines.push({ ...r.line, name: r.name, strength: r.strength, baseUnit: r.baseUnit, unitCostMinor: cost, variance, varianceMinor: Math.round(variance * cost) });
  }
  const counted = new Set(rows.map((r) => r.line.batchId).filter(Boolean));
  const uncounted = take.scope !== "full" || take.status !== "open" ? [] : (await t.select({ batch: stockBatches, name: products.name, strength: products.strength, baseUnit: products.baseUnit })
    .from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId))
    .where(and(eq(stockBatches.branchId, take.branchId), gt(stockBatches.qtyOnHand, 0))).orderBy(products.name))
    .filter((b) => !counted.has(b.batch.id))
    .map((b) => ({ ...b.batch, name: b.name, strength: b.strength, baseUnit: b.baseUnit, varianceMinor: -Math.round(b.batch.qtyOnHand * b.batch.unitCostMinor) }));
  const totals = {
    lines: lines.length, over: lines.filter((l) => l.variance > 0).length, short: lines.filter((l) => l.variance < 0).length,
    varianceMinor: lines.reduce((s, l) => s + l.varianceMinor, 0), uncountedMinor: uncounted.reduce((s, b) => s + b.varianceMinor, 0),
  };
  return { take, lines, uncounted, totals };
}

/**
 * Applies the take. Counted batches move by (counted − expected snapshot) so sales made after the count stay intact;
 * if that would go below zero (stock sold that was never there), the batch is set to zero instead.
 */
export async function completeTake(t: Tx, ctx: Ctx, takeId: string, o: { zeroUncounted: boolean }) {
  const take = await lockOpen(t, ctx, takeId);
  const report = (await varianceReport(t, takeId))!;
  if (report.uncounted.length && !o.zeroUncounted) {
    throw new UserError(`${report.uncounted.length} batches with stock weren't counted. Tick the box to set them to zero, or count them first.`);
  }
  const mv = { type: "stocktake" as const, ref: take.takeNo, refId: take.id, reason: "Stock take" };
  let adjusted = 0, found = 0, zeroed = 0, clamped = 0;
  for (const l of report.lines) {
    if (l.batchId) {
      const [b] = await t.select({ qty: stockBatches.qtyOnHand }).from(stockBatches).where(eq(stockBatches.id, l.batchId));
      let delta = l.countedQty - l.expectedQty;
      if (b.qty + delta < 0) { delta = -b.qty; clamped++; }
      if (delta) { await adjustBatch(t, ctx, { batchId: l.batchId, delta, ...mv }); adjusted++; }
    } else if (l.countedQty > 0) {
      await receiveIntoBatch(t, ctx, { productId: l.productId, branchId: take.branchId, qty: l.countedQty, batchNo: l.batchNo, expiry: l.expiry, unitCostMinor: l.unitCostMinor, ...mv });
      found++;
    }
  }
  for (const b of report.uncounted) {
    const [cur] = await t.select({ qty: stockBatches.qtyOnHand }).from(stockBatches).where(eq(stockBatches.id, b.id));
    if (cur.qty > 0) { await adjustBatch(t, ctx, { batchId: b.id, delta: -cur.qty, ...mv, reason: "Stock take: not found" }); zeroed++; }
  }
  await t.update(stockTakes).set({ status: "completed", completedBy: ctx.user.id, completedAt: new Date() }).where(eq(stockTakes.id, take.id));
  const summary = { takeNo: take.takeNo, scope: take.scope, adjusted, found, zeroed, clamped, varianceMinor: report.totals.varianceMinor + (o.zeroUncounted ? report.totals.uncountedMinor : 0) };
  await audit(t, ctx, "complete", "stock_take", take.id, { details: summary });
  await emit(t, ctx.tenant.id, "stock.adjusted", { id: take.id, branchId: take.branchId, ...summary });
  return summary;
}

export async function cancelTake(t: Tx, ctx: Ctx, takeId: string) {
  const take = await lockOpen(t, ctx, takeId);
  await t.update(stockTakes).set({ status: "cancelled", completedBy: ctx.user.id, completedAt: new Date() }).where(eq(stockTakes.id, take.id));
  await audit(t, ctx, "cancel", "stock_take", take.id, { details: { takeNo: take.takeNo } });
}

/** Product + units + its batches at the branch (for the counting screen), with what this take already counted. */
export async function productForCount(t: Tx, takeId: string, branchId: string, productId: string) {
  const [p] = await t.select().from(products).where(eq(products.id, productId));
  if (!p) return null;
  const units = await t.select().from(productUnits).where(eq(productUnits.productId, productId)).orderBy(sql`${productUnits.factor} desc`);
  const batches = await t.select({ id: stockBatches.id, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, qty: stockBatches.qtyOnHand, quarantined: stockBatches.quarantined,
    counted: sql<number | null>`(select counted_qty from stock_take_lines l where l.take_id = ${takeId} and l.batch_id = ${stockBatches.id} limit 1)` })
    .from(stockBatches).where(and(eq(stockBatches.productId, productId), eq(stockBatches.branchId, branchId)))
    .orderBy(sql`${stockBatches.qtyOnHand} = 0`, sql`${stockBatches.expiry} asc nulls last`);
  return {
    product: { id: p.id, name: p.name, strength: p.strength, form: p.form, baseUnit: p.baseUnit },
    units: units.map((u) => ({ id: u.id, name: u.name, factor: u.factor })),
    batches: batches.map((b) => ({ ...b, counted: b.counted === null ? null : Number(b.counted) })),
  };
}
export type CountTarget = NonNullable<Awaited<ReturnType<typeof productForCount>>>;
