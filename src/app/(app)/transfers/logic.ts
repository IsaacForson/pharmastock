import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { alerts, branches, products, stockBatches, transferLines, transfers } from "@/db/schema";
import { UserError } from "@/lib/action";
import { audit, type Ctx } from "@/lib/auth";
import { expiryState } from "@/lib/catalog";
import { localDay } from "@/lib/format";
import { nextNumber } from "@/lib/numbers";
import { adjustBatch, receiveIntoBatch, returnToBatch, takeFefo } from "@/lib/stock";

export type SendLine = { productId: string; qty: number; batchId?: string | null };

/** Sends stock from the current branch: picked batches via adjustBatch, the rest FEFO. Returns the transfer id. */
export async function sendTransfer(t: Tx, ctx: Ctx, o: { toBranchId: string; notes?: string | null; lines: SendLine[] }) {
  if (o.toBranchId === ctx.branchId) throw new UserError("Choose a different branch to send to");
  const [to] = await t.select({ id: branches.id }).from(branches).where(and(eq(branches.id, o.toBranchId), eq(branches.active, true)));
  if (!to) throw new UserError("That branch isn't available");
  if (!o.lines.length) throw new UserError("Add at least one item");
  const transferNo = await nextNumber(t, ctx.tenant.id, "transfer");
  const [tr] = await t.insert(transfers).values({ tenantId: ctx.tenant.id, transferNo, fromBranchId: ctx.branchId, toBranchId: o.toBranchId, notes: o.notes ?? null, sentBy: ctx.user.id }).returning();
  const today = localDay(ctx.tenant.timezone);
  for (const l of o.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new UserError("Quantities must be whole numbers above zero");
    let picked: { batchId: string; qty: number }[];
    if (l.batchId) {
      const [b] = await t.select().from(stockBatches).where(eq(stockBatches.id, l.batchId));
      if (!b || b.branchId !== ctx.branchId || b.productId !== l.productId) throw new UserError("That batch isn't at this branch");
      if (b.quarantined) throw new UserError(`Batch ${b.batchNo || "(no number)"} is quarantined and can't be sent`);
      if (expiryState(b.expiry, today) === "expired") throw new UserError(`Batch ${b.batchNo || "(no number)"} has expired and can't be sent`);
      await adjustBatch(t, ctx, { batchId: b.id, delta: -l.qty, reason: `Transfer ${transferNo}`, type: "transfer_out", ref: transferNo, refId: tr.id });
      picked = [{ batchId: b.id, qty: l.qty }];
    } else {
      const [p] = await t.select({ name: products.name }).from(products).where(eq(products.id, l.productId));
      if (!p) throw new UserError("Product not found");
      picked = (await takeFefo(t, ctx, { productId: l.productId, branchId: ctx.branchId, qty: l.qty, type: "transfer_out", ref: transferNo, refId: tr.id, productName: p.name })).allocations;
    }
    for (const a of picked) await t.insert(transferLines).values({ tenantId: ctx.tenant.id, transferId: tr.id, productId: l.productId, fromBatchId: a.batchId, qty: a.qty });
  }
  await audit(t, ctx, "send", "transfer", tr.id, { details: { transferNo, to: o.toBranchId, lines: o.lines.length } });
  return tr;
}

async function openTransfer(t: Tx, id: string) {
  const [tr] = await t.select().from(transfers).where(eq(transfers.id, id)).for("update");
  if (!tr) throw new UserError("Transfer not found");
  if (tr.status !== "in_transit") throw new UserError(`This transfer is already ${tr.status.replace("_", " ")}`);
  return tr;
}

/**
 * Receives at the destination branch into batches with the source batch number, expiry and cost. A short delivery needs
 * a reason, is noted on the transfer and raises a stock discrepancy alert at the destination.
 */
export async function receiveTransfer(t: Tx, ctx: Ctx, o: { id: string; received: Record<string, number>; shortReason?: string | null }) {
  const tr = await openTransfer(t, o.id);
  if (tr.toBranchId !== ctx.branchId) throw new UserError("Switch to the receiving branch to receive this transfer");
  const lines = await t.select({ l: transferLines, b: stockBatches }).from(transferLines)
    .innerJoin(stockBatches, eq(stockBatches.id, transferLines.fromBatchId)).where(eq(transferLines.transferId, tr.id));
  let shortQty = 0, shortValue = 0;
  for (const { l, b } of lines) {
    const got = o.received[l.id] ?? l.qty;
    if (!Number.isInteger(got) || got < 0 || got > l.qty) throw new UserError(`Received quantity must be between 0 and ${l.qty}`);
    let toBatchId: string | null = null;
    if (got > 0) {
      const nb = await receiveIntoBatch(t, ctx, {
        productId: l.productId, branchId: tr.toBranchId, qty: got, batchNo: b.batchNo, expiry: b.expiry, mfgDate: b.mfgDate,
        unitCostMinor: b.unitCostMinor, supplierId: b.supplierId, type: "transfer_in", ref: tr.transferNo, refId: tr.id,
      });
      toBatchId = nb.id;
    }
    shortQty += l.qty - got;
    shortValue += (l.qty - got) * b.unitCostMinor;
    await t.update(transferLines).set({ receivedQty: got, toBatchId }).where(eq(transferLines.id, l.id));
  }
  const reason = o.shortReason?.trim();
  if (shortQty > 0 && !reason) throw new UserError("Some items are short. Say what happened to them");
  await t.update(transfers).set({
    status: "received", receivedBy: ctx.user.id, receivedAt: new Date(),
    notes: shortQty ? [tr.notes, `Short received (${shortQty}): ${reason}`].filter(Boolean).join("\n") : tr.notes,
  }).where(eq(transfers.id, tr.id));
  if (shortQty) {
    await t.insert(alerts).values({
      tenantId: ctx.tenant.id, branchId: tr.toBranchId, kind: "stock_discrepancy", title: `${tr.transferNo} arrived short by ${shortQty}`,
      detail: reason, valueMinor: Math.round(shortValue), dedupeKey: `transfer_short:${tr.id}`,
    }).onConflictDoNothing();
  }
  await audit(t, ctx, "receive", "transfer", tr.id, { details: { transferNo: tr.transferNo, shortQty, reason } });
  return { shortQty };
}

/** Cancels an in-transit transfer: every line goes back into the batch it left. */
export async function cancelTransfer(t: Tx, ctx: Ctx, o: { id: string; reason?: string | null }) {
  const tr = await openTransfer(t, o.id);
  if (tr.fromBranchId !== ctx.branchId) throw new UserError("Only the sending branch can cancel this transfer");
  const lines = await t.select().from(transferLines).where(eq(transferLines.transferId, tr.id));
  for (const l of lines) await returnToBatch(t, ctx, { batchId: l.fromBatchId, qty: l.qty, type: "transfer_in", ref: tr.transferNo, refId: tr.id, reason: "Transfer cancelled" });
  await t.update(transfers).set({ status: "cancelled", notes: [tr.notes, o.reason && `Cancelled: ${o.reason}`].filter(Boolean).join("\n") || null }).where(eq(transfers.id, tr.id));
  await audit(t, ctx, "cancel", "transfer", tr.id, { details: { transferNo: tr.transferNo, reason: o.reason } });
}
