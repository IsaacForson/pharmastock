"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { requireWrite, tx, type Ctx } from "@/lib/auth";
import { hasFeature } from "@/lib/plans";
import {
  acceptSupplierChanges, cancelPurchaseOrder, createDraftPos, createPurchaseOrder, poLineInput, sendPurchaseOrder, updatePurchaseOrder,
} from "@/lib/purchasing";

const json = z.string().transform((s, c) => { try { return JSON.parse(s) as unknown; } catch { c.addIssue({ code: "custom", message: "Invalid lines" }); return z.NEVER; } });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const poSchema = z.object({
  id: z.string().uuid().optional(), supplierId: z.string({ message: "Choose a supplier" }).uuid("Choose a supplier"),
  notes: z.string().max(1000).optional(), expectedAt: date,
  lines: json.pipe(z.array(poLineInput).min(1, "Add at least one product").max(500)),
});

export async function savePoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("purchasing.manage");
    const o = poSchema.parse(formObject(fd));
    const id = await tx(ctx, async (t) => {
      if (o.id) { await updatePurchaseOrder(t, ctx, o.id, o); return o.id; }
      return (await createPurchaseOrder(t, ctx, o)).id;
    });
    revalidatePath("/purchasing");
    return { ok: true, id };
  });
}

const reorderSchema = z.object({
  lines: json.pipe(z.array(poLineInput.extend({ supplierId: z.string().uuid("Every line needs a supplier") })).min(1, "Tick at least one line").max(500)),
});

export async function createReorderPosAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("purchasing.manage");
    const o = reorderSchema.parse(formObject(fd));
    const pos = await tx(ctx, (t) => createDraftPos(t, ctx, o.lines));
    revalidatePath("/purchasing");
    return { ok: true, id: pos.length === 1 ? pos[0].id : "", message: `${pos.length} draft order${pos.length === 1 ? "" : "s"} created: ${pos.map((p) => p.poNo).join(", ")}` };
  });
}

const idSchema = z.object({ id: z.string().uuid() });
async function poStep(fd: FormData, fn: (ctx: Ctx, id: string) => Promise<string | void>) {
  return run(async () => {
    const ctx = await requireWrite("purchasing.manage");
    const { id } = idSchema.parse(formObject(fd));
    const message = await fn(ctx, id);
    revalidatePath(`/purchasing/${id}`);
    revalidatePath("/purchasing");
    return { ok: true, message: message || undefined };
  });
}

export async function sendPoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const via = z.enum(["whatsapp", "email"]).parse(fd.get("via"));
  return poStep(fd, async (ctx, id) => {
    if (!hasFeature(ctx.tenant, "supplier_ordering")) throw new UserError("Sending orders to suppliers is on the Pro plan. You can still print the order.");
    await tx(ctx, (t) => sendPurchaseOrder(t, ctx, id, via));
    return via === "email" ? "Order emailed to the supplier." : "Order sent on WhatsApp.";
  });
}

export async function cancelPoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return poStep(fd, (ctx, id) => tx(ctx, (t) => cancelPurchaseOrder(t, ctx, id)));
}

export async function acceptSupplierChangesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return poStep(fd, async (ctx, id) => { await tx(ctx, (t) => acceptSupplierChanges(t, ctx, id)); return "Supplier's quantities and prices accepted."; });
}
