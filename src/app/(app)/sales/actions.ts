"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { requireWrite, tx } from "@/lib/auth";
import { returnSale, voidSale } from "@/lib/sales";

export async function voidSaleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("pos.void");
    const o = z.object({ saleId: z.uuid(), reason: z.string().trim().min(3, "Say why the sale is being voided").max(300) }).parse(formObject(fd));
    await tx(ctx, (t) => voidSale(t, ctx, o));
    revalidatePath(`/sales/${o.saleId}`);
    revalidatePath("/sales");
    return { ok: true, message: "Sale voided. Stock, payments, credit and points were reversed." };
  });
}

export async function returnSaleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("pos.return");
    const f = formObject(fd);
    const o = z.object({
      saleId: z.uuid(), reason: z.string().trim().min(3, "Give a reason for the return").max(300),
      restock: z.enum(["yes", "no"]), refundMethod: z.enum(["cash", "mobile_money", "card", "bank", "credit"]),
    }).parse(f);
    const lines = Object.entries(f).filter(([k, v]) => k.startsWith("qty_") && v).map(([k, v]) => ({ saleLineId: z.uuid().parse(k.slice(4)), baseQty: z.coerce.number().int().nonnegative().parse(v) })).filter((l) => l.baseQty > 0);
    if (!lines.length) throw new UserError("Enter how many of each item is coming back");
    const r = await tx(ctx, (t) => returnSale(t, ctx, { saleId: o.saleId, lines, reason: o.reason, restock: o.restock === "yes", refundMethod: o.refundMethod }));
    revalidatePath(`/sales/${o.saleId}`);
    return { ok: true, message: `Return ${r.returnNo} recorded. Refund ${(r.refundMinor / 100).toFixed(2)}.` };
  });
}
