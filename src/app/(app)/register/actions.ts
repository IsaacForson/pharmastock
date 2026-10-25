"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Tx } from "@/db";
import { products, stockBatches } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx, type Ctx } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { emit } from "@/lib/events";
import { hasFeature } from "@/lib/plans";
import { adjustBatch, returnToBatch } from "@/lib/stock";

const uuid = z.string().uuid("Choose a batch");
const qty = z.coerce.number().int().positive("Enter a quantity of 1 or more");

async function writeCtx(perm: Permission) {
  const ctx = await requireWrite(perm);
  if (!hasFeature(ctx.tenant, "controlled")) throw new UserError("The controlled-drug register is on the Pro and Chain plans.");
  return ctx;
}

/** The batch must be a controlled product's batch at the user's branch. */
async function controlledBatch(t: Tx, ctx: Ctx, batchId: string) {
  const [b] = await t.select({ id: stockBatches.id, productId: stockBatches.productId, batchNo: stockBatches.batchNo }).from(stockBatches)
    .innerJoin(products, eq(products.id, stockBatches.productId))
    .where(and(eq(stockBatches.id, batchId), eq(stockBatches.branchId, ctx.branchId), eq(products.schedule, "controlled")));
  if (!b) throw new UserError("That batch isn't a controlled drug at this branch");
  return b;
}

const destroySchema = z.object({
  batchId: uuid, qty, kind: z.enum(["expire", "damage"]), witnessName: z.string().min(2, "A witness name is required for destruction"),
  note: z.string().max(500).optional(),
});

export async function destroyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await writeCtx("controlled.destroy");
    const o = destroySchema.parse(formObject(fd));
    const productId = await tx(ctx, async (t) => {
      const b = await controlledBatch(t, ctx, o.batchId);
      await adjustBatch(t, ctx, { batchId: b.id, delta: -o.qty, type: o.kind, reason: o.note ?? (o.kind === "expire" ? "Expired: destroyed" : "Damaged: destroyed"), register: { witnessName: o.witnessName, note: o.note ?? null } });
      await audit(t, ctx, "destroy", "stock_batch", b.id, { details: { qty: o.qty, kind: o.kind, witness: o.witnessName } });
      await emit(t, ctx.tenant.id, "stock.adjusted", { batchId: b.id, productId: b.productId, branchId: ctx.branchId, delta: -o.qty, type: o.kind });
      return b.productId;
    });
    revalidatePath(`/register/${productId}`);
    revalidatePath("/register");
    return { ok: true, message: "Destruction recorded in the register." };
  });
}

const returnSchema = z.object({
  batchId: uuid, qty, partyName: z.string().min(2, "Who returned it?"), partyAddress: z.string().max(300).optional(),
  rxNo: z.string().max(60).optional(), note: z.string().max(500).optional(),
});

export async function patientReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await writeCtx("controlled.register");
    const o = returnSchema.parse(formObject(fd));
    const productId = await tx(ctx, async (t) => {
      const b = await controlledBatch(t, ctx, o.batchId);
      await returnToBatch(t, ctx, { batchId: b.id, qty: o.qty, type: "sale_return", reason: o.note ?? "Returned by customer", register: { partyName: o.partyName, partyAddress: o.partyAddress ?? null, rxNo: o.rxNo ?? null, note: o.note ?? null } });
      await audit(t, ctx, "customer_return", "stock_batch", b.id, { details: { qty: o.qty, rxNo: o.rxNo } });
      await emit(t, ctx.tenant.id, "stock.adjusted", { batchId: b.id, productId: b.productId, branchId: ctx.branchId, delta: o.qty, type: "sale_return" });
      return b.productId;
    });
    revalidatePath(`/register/${productId}`);
    revalidatePath("/register");
    return { ok: true, message: "Return recorded in the register." };
  });
}

const correctSchema = z.object({
  batchId: uuid, delta: z.coerce.number().int().refine((n) => n !== 0, "Enter how many to add (+) or remove (-)"),
  reason: z.string().min(3, "Say why the balance is being corrected").max(500),
});

export async function correctionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await writeCtx("controlled.register");
    const o = correctSchema.parse(formObject(fd));
    const productId = await tx(ctx, async (t) => {
      const b = await controlledBatch(t, ctx, o.batchId);
      await adjustBatch(t, ctx, { batchId: b.id, delta: o.delta, type: "adjust", reason: o.reason, register: { note: o.reason } });
      await audit(t, ctx, "adjust", "stock_batch", b.id, { details: { delta: o.delta, reason: o.reason, via: "register" } });
      await emit(t, ctx.tenant.id, "stock.adjusted", { batchId: b.id, productId: b.productId, branchId: ctx.branchId, delta: o.delta, type: "adjust" });
      return b.productId;
    });
    revalidatePath(`/register/${productId}`);
    revalidatePath("/register");
    return { ok: true, message: "Correction recorded in the register." };
  });
}
