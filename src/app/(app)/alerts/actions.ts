"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formObject, run, type ActionState } from "@/lib/action";
import { requireWrite, tx } from "@/lib/auth";
import { emit } from "@/lib/events";
import { quarantineAlertBatch, RESOLUTIONS, resolveAlert, writeOffAlert } from "./logic";

const done = () => { revalidatePath("/alerts"); revalidatePath("/stock"); revalidatePath("/dashboard"); };

export async function resolveAlertAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.take");
    const o = z.object({ id: z.uuid(), resolution: z.enum(RESOLUTIONS, "Choose what you did") }).parse(formObject(fd));
    await tx(ctx, (t) => resolveAlert(t, ctx, o));
    done();
  });
}

export async function writeOffAlertAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.adjust");
    const o = z.object({ id: z.uuid(), witnessName: z.string().max(120).optional() }).parse(formObject(fd));
    const r = await tx(ctx, async (t) => {
      const r = await writeOffAlert(t, ctx, o);
      await emit(t, ctx.tenant.id, "stock.adjusted", { alertId: o.id, type: "expire", qty: -r.qty, branchId: ctx.branchId });
      return r;
    });
    done();
    return { ok: true, message: `${r.qty} written off.` };
  });
}

export async function quarantineAlertAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.adjust");
    const o = z.object({ id: z.uuid() }).parse(formObject(fd));
    await tx(ctx, (t) => quarantineAlertBatch(t, ctx, o));
    done();
  });
}
