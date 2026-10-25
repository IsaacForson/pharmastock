"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, zBool, zMoney, type ActionState } from "@/lib/action";
import { requireWrite, tx } from "@/lib/auth";
import { createSupplierReturn, recordCredit, RETURN_REASONS, type ReturnReason } from "@/lib/purchasing";

const createSchema = z.object({
  supplierId: z.string().uuid("Choose a supplier"),
  reason: z.enum(Object.keys(RETURN_REASONS) as [ReturnReason, ...ReturnReason[]]),
  notes: z.string().max(1000).optional(),
});

export async function createReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("purchasing.manage");
    const o = createSchema.parse(formObject(fd));
    // One "qty:<batchId>" field per batch (base units).
    const lines = [...fd.entries()].filter(([k]) => k.startsWith("qty:")).map(([k, v]) => ({
      batchId: z.string().uuid().parse(k.slice(4)), qty: z.coerce.number().int().min(0).max(10_000_000).parse(v || 0),
    }));
    const ret = await tx(ctx, (t) => createSupplierReturn(t, ctx, { ...o, lines }));
    revalidatePath("/returns");
    revalidatePath("/alerts");
    return { ok: true, id: ret.id };
  });
}

const creditSchema = z.object({ id: z.string().uuid(), creditNoteNo: z.string().max(80).optional(), amount: zMoney.optional(), rejected: zBool });

export async function recordCreditAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("supplier.payments");
    const o = creditSchema.parse(formObject(fd));
    const status = await tx(ctx, (t) => recordCredit(t, ctx, { returnId: o.id, creditNoteNo: o.creditNoteNo, creditedMinor: o.amount ?? 0, rejected: o.rejected }));
    revalidatePath(`/returns/${o.id}`);
    revalidatePath("/returns");
    return { ok: true, message: status === "rejected" ? "Marked as rejected." : "Credit note recorded." };
  });
}
