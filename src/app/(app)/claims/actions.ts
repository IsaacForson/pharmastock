"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { payers } from "@/db/schema";
import { formObject, run, UserError, zBool, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { createClaim, removeClaimItem, settleClaimItem, submitClaim } from "@/lib/claims";
import { e164 } from "@/lib/format";
import { hasFeature } from "@/lib/plans";

async function guard() {
  const ctx = await requireWrite("claims.manage");
  if (!hasFeature(ctx.tenant, "claims")) throw new UserError("Insurance claims need the Pro plan");
  return ctx;
}

export async function savePayerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({
      id: z.uuid().optional(), name: z.string().trim().min(2, "Enter the payer's name").max(120), kind: z.enum(["insurer", "hmo", "corporate", "nhis"]),
      code: z.string().max(40).optional(), contactName: z.string().max(120).optional(), phone: z.string().max(30).optional(), email: z.email().max(200).optional(),
      coverage: z.coerce.number().min(0).max(100), active: zBool,
    }).parse(formObject(fd));
    const values = { name: o.name, kind: o.kind, code: o.code ?? null, contactName: o.contactName ?? null, phone: e164(o.phone, ctx.tenant.country), email: o.email ?? null, coverageBp: Math.round(o.coverage * 100), active: o.id ? o.active : true };
    await tx(ctx, async (t) => {
      if (o.id) {
        const [p] = await t.update(payers).set(values).where(eq(payers.id, o.id)).returning({ id: payers.id });
        if (!p) throw new UserError("Payer not found");
        await audit(t, ctx, "update", "payer", p.id, { details: { name: o.name, coverageBp: values.coverageBp, active: values.active } });
      } else {
        const [p] = await t.insert(payers).values({ tenantId: ctx.tenant.id, ...values }).returning({ id: payers.id });
        await audit(t, ctx, "create", "payer", p.id, { details: { name: o.name } });
      }
    });
    revalidatePath("/claims/payers");
    return { ok: true, message: "Saved." };
  });
}

export async function createClaimAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({ payerId: z.uuid(), from: z.iso.date(), to: z.iso.date() }).parse(formObject(fd));
    const c = await tx(ctx, (t) => createClaim(t, ctx, o));
    revalidatePath("/claims");
    return { ok: true, id: c.id };
  });
}

export async function submitClaimAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const { id } = z.object({ id: z.uuid() }).parse(formObject(fd));
    await tx(ctx, (t) => submitClaim(t, ctx, id));
    revalidatePath(`/claims/${id}`);
    revalidatePath("/claims");
  });
}

export async function removeClaimItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({ itemId: z.uuid(), claimId: z.uuid() }).parse(formObject(fd));
    await tx(ctx, (t) => removeClaimItem(t, ctx, o.itemId));
    revalidatePath(`/claims/${o.claimId}`);
  });
}

export async function settleItemAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({ itemId: z.uuid(), claimId: z.uuid(), paid: zMoney.default(0), rejected: zBool, reason: z.string().max(300).optional() }).parse(formObject(fd));
    const status = await tx(ctx, (t) => settleClaimItem(t, ctx, { itemId: o.itemId, paidMinor: o.paid, rejected: o.rejected, reason: o.reason }));
    revalidatePath(`/claims/${o.claimId}`);
    revalidatePath("/claims");
    return { ok: true, message: status.replace("_", " ") };
  });
}
