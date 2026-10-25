import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { alerts, products, stockBatches } from "@/db/schema";
import { UserError } from "@/lib/action";
import { audit, type Ctx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { adjustBatch } from "@/lib/stock";

export const RESOLUTIONS = ["discounted", "transferred", "returned", "written_off", "ordered", "dismissed"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

async function openAlert(t: Tx, ctx: Ctx, id: string) {
  const [a] = await t.select().from(alerts).where(and(eq(alerts.id, id), eq(alerts.branchId, ctx.branchId))).for("update");
  if (!a) throw new UserError("Alert not found at this branch");
  if (a.status !== "open") throw new UserError("This alert is already closed");
  return a;
}

export async function resolveAlert(t: Tx, ctx: Ctx, o: { id: string; resolution: Resolution }) {
  const a = await openAlert(t, ctx, o.id);
  await t.update(alerts).set({ status: o.resolution === "dismissed" ? "dismissed" : "done", resolution: o.resolution, resolvedBy: ctx.user.id, resolvedAt: new Date() }).where(eq(alerts.id, a.id));
  await audit(t, ctx, "resolve", "alert", a.id, { details: { kind: a.kind, resolution: o.resolution } });
}

/** Writes off everything left in the alert's batch as expired stock, then closes the alert. */
export async function writeOffAlert(t: Tx, ctx: Ctx, o: { id: string; witnessName?: string | null }) {
  const a = await openAlert(t, ctx, o.id);
  if (!a.batchId) throw new UserError("This alert isn't about a batch");
  const [b] = await t.select({ qty: stockBatches.qtyOnHand, batchNo: stockBatches.batchNo, schedule: products.schedule })
    .from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId)).where(eq(stockBatches.id, a.batchId));
  if (!b) throw new UserError("Batch not found");
  if (b.schedule === "controlled") {
    if (!can(ctx.user.role, "controlled.destroy")) throw new UserError("Only a pharmacist can destroy controlled drugs");
    if (!o.witnessName?.trim()) throw new UserError("Destroying a controlled drug needs a witness name for the register");
  }
  if (b.qty > 0) {
    await adjustBatch(t, ctx, {
      batchId: a.batchId, delta: -b.qty, type: "expire", reason: `Written off from alert: ${a.title}`, ref: "ALERT", refId: a.id,
      register: o.witnessName?.trim() ? { witnessName: o.witnessName.trim(), note: "Expired stock destroyed" } : undefined,
    });
  }
  await t.update(alerts).set({ status: "done", resolution: "written_off", resolvedBy: ctx.user.id, resolvedAt: new Date() }).where(eq(alerts.id, a.id));
  await audit(t, ctx, "write_off", "stock_batch", a.batchId, { details: { alertId: a.id, qty: b.qty, batchNo: b.batchNo, witness: o.witnessName ?? undefined } });
  return { qty: b.qty };
}

/** Quarantines the alert's batch (recalls): not sellable, quantity unchanged. Alert stays open until returned or written off. */
export async function quarantineAlertBatch(t: Tx, ctx: Ctx, o: { id: string }) {
  const a = await openAlert(t, ctx, o.id);
  if (!a.batchId) throw new UserError("This alert isn't about a batch");
  await t.update(stockBatches).set({ quarantined: true, quarantineReason: a.title }).where(eq(stockBatches.id, a.batchId));
  await audit(t, ctx, "quarantine", "stock_batch", a.batchId, { details: { alertId: a.id, reason: a.title } });
}
