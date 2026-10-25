"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, type ActionState } from "@/lib/action";
import { audit, AuthError, getCtx, tx } from "@/lib/auth";

// The request is recorded in the append-only audit log (entity "tenant", action deletion_request / deletion_cancel); platform ops act on it.
async function ownerCtx() {
  const ctx = await getCtx();
  if (!ctx || ctx.user.role !== "owner" || ctx.impersonatedBy) throw new AuthError("Only the pharmacy owner can do that.");
  return ctx;
}

export async function requestDeletionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await ownerCtx();
    const o = z.object({ confirm: z.literal("DELETE", { message: 'Type DELETE to confirm' }), reason: z.string().max(1000).optional() }).parse(formObject(fd));
    const deleteAfter = new Date(Date.now() + 30 * 86400_000).toISOString();
    await tx(ctx, (t) => audit(t, ctx, "deletion_request", "tenant", ctx.tenant.id, { details: { reason: o.reason ?? null, deleteAfter } }));
    revalidatePath("/settings/data");
    return { ok: true, message: "Deletion requested. We will confirm by email and permanently delete your data after 30 days unless you cancel." };
  });
}

export async function cancelDeletionAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await ownerCtx();
    await tx(ctx, (t) => audit(t, ctx, "deletion_cancel", "tenant", ctx.tenant.id));
    revalidatePath("/settings/data");
    return { ok: true, message: "Deletion request cancelled." };
  });
}
