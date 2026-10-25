"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { expenses } from "@/db/schema";
import { formObject, run, UserError, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { localDay } from "@/lib/format";

export async function addExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("expenses.manage");
    const o = z.object({
      category: z.string().trim().min(2, "Choose a category").max(60), description: z.string().max(300).optional(), paidTo: z.string().max(120).optional(),
      amount: zMoney, method: z.enum(["cash", "mobile_money", "card", "bank"]), day: z.iso.date(),
    }).parse(formObject(fd));
    if (!o.amount) throw new UserError("Enter an amount");
    if (o.day > localDay(ctx.tenant.timezone)) throw new UserError("The date is in the future");
    await tx(ctx, async (t) => {
      const [e] = await t.insert(expenses).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, category: o.category, description: o.description ?? null, paidTo: o.paidTo ?? null, amountMinor: o.amount, method: o.method, day: o.day, createdBy: ctx.user.id }).returning({ id: expenses.id });
      await audit(t, ctx, "create", "expense", e.id, { details: { amount: o.amount, category: o.category, method: o.method } });
    });
    revalidatePath("/expenses");
    revalidatePath("/cashup");
    return { ok: true, message: "Expense recorded." };
  });
}

export async function deleteExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("expenses.manage");
    const { id } = z.object({ id: z.uuid() }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [e] = await t.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.branchId, ctx.branchId), eq(expenses.day, localDay(ctx.tenant.timezone)))).returning();
      if (!e) throw new UserError("Only today's expenses at this branch can be removed");
      await audit(t, ctx, "delete", "expense", id, { details: { amount: e.amountMinor, category: e.category } });
    });
    revalidatePath("/expenses");
    revalidatePath("/cashup");
  });
}
