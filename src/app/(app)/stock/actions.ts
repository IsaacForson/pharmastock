"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { products, stockBatches } from "@/db/schema";
import { formObject, run, UserError, zBool, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { emit } from "@/lib/events";
import { can } from "@/lib/permissions";
import { adjustBatch } from "@/lib/stock";

const adjustSchema = z.object({
  batchId: z.string().uuid(),
  kind: z.enum(["count", "damage", "expire", "correct"]),
  qty: z.coerce.number().int("Whole numbers only"),
  factor: z.coerce.number().int().min(1).default(1),
  reason: z.string().max(300).optional(),
  witness: z.string().max(120).optional(),
});

/**
 * count = the shelf actually has `qty` (sets the batch to that), damage / expire = remove `qty`, correct = signed change.
 * qty is in packs of `factor` base units.
 */
export async function adjustBatchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.adjust");
    const o = adjustSchema.parse(formObject(fd));
    const base = o.qty * o.factor;
    const res = await tx(ctx, async (t) => {
      const [row] = await t.select({ b: stockBatches, schedule: products.schedule, name: products.name }).from(stockBatches)
        .innerJoin(products, eq(products.id, stockBatches.productId)).where(eq(stockBatches.id, o.batchId)).for("update", { of: stockBatches });
      if (!row || row.b.branchId !== ctx.branchId) throw new UserError("That batch isn't at this branch");
      const destroy = o.kind === "damage" || o.kind === "expire";
      if (destroy && base <= 0) throw new UserError("Enter how many to remove");
      if (o.kind === "count" && base < 0) throw new UserError("A count can't be negative");
      if (o.kind === "correct" && !o.reason) throw new UserError("Say why you're correcting the stock");
      const delta = o.kind === "count" ? base - row.b.qtyOnHand : destroy ? -base : base;
      if (!delta) throw new UserError("That matches what's on record already. Nothing changed.");
      const controlled = row.schedule === "controlled";
      if (controlled && destroy) {
        if (!can(ctx.user.role, "controlled.destroy")) throw new UserError("Only a pharmacist can destroy a controlled drug");
        if (!o.witness) throw new UserError("Destroying a controlled drug needs a witness name");
      }
      const reason = o.reason ?? { count: "Count correction", damage: "Damaged", expire: "Expired", correct: "Correction" }[o.kind];
      await adjustBatch(t, ctx, {
        batchId: row.b.id, delta, reason, type: o.kind === "damage" ? "damage" : o.kind === "expire" ? "expire" : "adjust",
        register: controlled ? { witnessName: o.witness ?? null, note: reason } : undefined,
      });
      await audit(t, ctx, "adjust", "stock_batch", row.b.id, { details: { kind: o.kind, delta, reason, productId: row.b.productId, witness: o.witness } });
      await emit(t, ctx.tenant.id, "stock.adjusted", { batchId: row.b.id, productId: row.b.productId, branchId: row.b.branchId, delta, type: o.kind, reason });
      return { delta, productId: row.b.productId };
    });
    revalidatePath(`/stock/batches/${o.batchId}`);
    revalidatePath("/stock");
    revalidatePath(`/products/${res.productId}`);
    return { ok: true, message: `Stock ${res.delta > 0 ? "increased" : "reduced"} by ${Math.abs(res.delta)}.` };
  });
}

const quarantineSchema = z.object({ batchId: z.string().uuid(), quarantine: zBool, reason: z.string().max(300).optional() });

/** Quarantine stops a batch being sold (recall, investigation). Not a quantity change, so no movement; audited. */
export async function quarantineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.adjust");
    const o = quarantineSchema.parse(formObject(fd));
    if (o.quarantine && !o.reason) throw new UserError("Say why the batch is quarantined");
    const productId = await tx(ctx, async (t) => {
      const [b] = await t.update(stockBatches).set({ quarantined: o.quarantine, quarantineReason: o.quarantine ? o.reason! : null })
        .where(eq(stockBatches.id, o.batchId)).returning();
      if (!b || b.branchId !== ctx.branchId) throw new UserError("That batch isn't at this branch");
      await audit(t, ctx, o.quarantine ? "quarantine" : "release", "stock_batch", b.id, { details: { reason: o.reason, productId: b.productId } });
      return b.productId;
    });
    revalidatePath(`/stock/batches/${o.batchId}`);
    revalidatePath("/stock");
    revalidatePath(`/products/${productId}`);
    return { ok: true, message: o.quarantine ? "Batch quarantined. It can't be sold until released." : "Batch released for sale." };
  });
}
