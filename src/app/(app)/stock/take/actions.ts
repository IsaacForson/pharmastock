"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, UserError, zBool, type ActionState } from "@/lib/action";
import { AuthError, requireWrite, tx } from "@/lib/auth";
import { findByBarcode, searchProducts } from "@/lib/catalog";
import { cancelTake, completeTake, deleteLine, productForCount, recordCount, startTake, type CountTarget } from "./logic";

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the expiry as a date");

export async function startTakeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.take");
    const o = z.object({ scope: z.enum(["full", "partial"]), notes: z.string().max(500).optional(), product: id.optional() }).parse(formObject(fd));
    const take = await tx(ctx, (t) => startTake(t, ctx, o));
    revalidatePath("/stock/take");
    return { ok: true, id: o.product ? `${take.id}?product=${o.product}` : take.id };
  });
}

/** Scan or type: exact barcode first, then name search. One hit opens it for counting; several come back as choices. */
export async function lookupAction(takeId: string, q: string): Promise<{ error?: string; target?: CountTarget; choices?: { id: string; label: string }[] }> {
  try {
    const ctx = await requireWrite("stock.take");
    const term = z.string().trim().min(1).max(80).parse(q);
    id.parse(takeId);
    return await tx(ctx, async (t) => {
      const hit = await findByBarcode(t, term);
      if (hit) return { target: (await productForCount(t, takeId, ctx.branchId, hit.product.id))! };
      const found = await searchProducts(t, term, ctx.branchId, 8);
      if (!found.length) return { error: `Nothing matches "${term}". Check the barcode or add the product first.` };
      if (found.length === 1) return { target: (await productForCount(t, takeId, ctx.branchId, found[0].product.id))! };
      return { choices: found.map((f) => ({ id: f.product.id, label: [f.product.name, f.product.strength, f.product.form].filter(Boolean).join(" ") })) };
    });
  } catch (e) {
    return { error: safe(e, "Couldn't look that up") };
  }
}

export async function openProductAction(takeId: string, productId: string): Promise<{ error?: string; target?: CountTarget }> {
  try {
    const ctx = await requireWrite("stock.take");
    const target = await tx(ctx, (t) => productForCount(t, id.parse(takeId), ctx.branchId, id.parse(productId)));
    return target ? { target } : { error: "Product not found" };
  } catch (e) {
    return { error: safe(e, "Couldn't open that product") };
  }
}

const safe = (e: unknown, fallback: string) => (e instanceof UserError || e instanceof AuthError ? e.message : fallback);

const countSchema = z.object({
  takeId: id, productId: id, batchId: id.optional(), batchNo: z.string().max(60).optional(), expiry: day.optional(),
  qty: z.coerce.number().int().min(0, "Count can't be negative"),
});

export async function saveCountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.take");
    const o = countSchema.parse(formObject(fd));
    await tx(ctx, (t) => recordCount(t, ctx, o.takeId, { productId: o.productId, batchId: o.batchId, batchNo: o.batchNo, expiry: o.expiry, countedQty: o.qty }));
    revalidatePath(`/stock/take/${o.takeId}`);
    return { ok: true, message: "Count saved" };
  });
}

export async function deleteLineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.take");
    const o = z.object({ takeId: id, lineId: id }).parse(formObject(fd));
    await tx(ctx, (t) => deleteLine(t, ctx, o.takeId, o.lineId));
    revalidatePath(`/stock/take/${o.takeId}`);
  });
}

export async function completeTakeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.adjust");
    const o = z.object({ takeId: id, zeroUncounted: zBool }).parse(formObject(fd));
    await tx(ctx, (t) => completeTake(t, ctx, o.takeId, { zeroUncounted: o.zeroUncounted }));
    revalidatePath("/stock", "layout");
    return { ok: true, id: o.takeId };
  });
}

export async function cancelTakeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.take");
    const o = z.object({ takeId: id }).parse(formObject(fd));
    await tx(ctx, (t) => cancelTake(t, ctx, o.takeId));
    revalidatePath("/stock/take", "layout");
  });
}
