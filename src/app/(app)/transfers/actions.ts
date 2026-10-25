"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { requireWrite, tx } from "@/lib/auth";
import { hasFeature } from "@/lib/plans";
import { cancelTransfer, receiveTransfer, sendTransfer } from "./logic";

async function ctxFor() {
  const ctx = await requireWrite("stock.transfer");
  if (!hasFeature(ctx.tenant, "transfers")) throw new UserError("Branch transfers are part of the Chain plan");
  return ctx;
}
const done = () => { revalidatePath("/transfers"); revalidatePath("/stock"); revalidatePath("/alerts"); };

const sendSchema = z.object({
  toBranchId: z.uuid("Choose the branch to send to"),
  notes: z.string().max(500).optional(),
  lines: z.string().transform((s, c) => { try { return JSON.parse(s); } catch { c.addIssue({ code: "custom", message: "Add at least one item" }); return z.NEVER; } })
    .pipe(z.array(z.object({ productId: z.uuid(), qty: z.number().int().positive("Quantities must be above zero"), batchId: z.uuid().nullable().optional() })).min(1, "Add at least one item").max(200)),
});

export async function sendTransferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await ctxFor();
    const o = sendSchema.parse(formObject(fd));
    const tr = await tx(ctx, (t) => sendTransfer(t, ctx, o));
    done();
    return { ok: true, id: tr.id };
  });
}

export async function receiveTransferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await ctxFor();
    const f = formObject(fd);
    const id = z.uuid().parse(f.id);
    const received: Record<string, number> = {};
    for (const [k, v] of Object.entries(f)) if (k.startsWith("got_")) received[k.slice(4)] = z.coerce.number().int().min(0).parse(v ?? "0");
    const r = await tx(ctx, (t) => receiveTransfer(t, ctx, { id, received, shortReason: f.shortReason }));
    done();
    return { ok: true, message: r.shortQty ? `Received, ${r.shortQty} short. A discrepancy alert was raised.` : "Received in full." };
  });
}

export async function cancelTransferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await ctxFor();
    const f = formObject(fd);
    await tx(ctx, (t) => cancelTransfer(t, ctx, { id: z.uuid().parse(f.id), reason: f.reason }));
    done();
    return { ok: true, message: "Transfer cancelled. Stock is back in its batches." };
  });
}
