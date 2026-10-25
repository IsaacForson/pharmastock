"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { cashUps } from "@/db/schema";
import { formObject, run, UserError, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { variance } from "@/lib/cashup";
import { localDay, money } from "@/lib/format";
import { daySummary } from "./data";

export async function saveCashupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("cashup");
    const o = z.object({ day: z.iso.date(), countedCash: zMoney, countedMomo: zMoney.optional(), notes: z.string().max(1000).optional() }).parse(formObject(fd));
    if (o.day > localDay(ctx.tenant.timezone)) throw new UserError("You can't close a day that hasn't happened yet");
    const v = await tx(ctx, async (t) => {
      const s = await daySummary(t, ctx.branchId, o.day, ctx.tenant.timezone);
      const cash = variance(o.countedCash, s.expected.cash);
      const momo = o.countedMomo === undefined ? null : variance(o.countedMomo, s.expected.mobile_money);
      const [row] = await t.insert(cashUps).values({
        tenantId: ctx.tenant.id, branchId: ctx.branchId, day: o.day, userId: ctx.user.id,
        expected: { ...s.expected, creditGiven: s.creditGiven, repayments: s.repaymentTotal, expensesCash: s.expenses.cash, sales: s.salesTotal, salesCount: s.salesCount, ...(momo !== null ? { momoVariance: momo } : {}) },
        countedCashMinor: o.countedCash, countedMomoMinor: o.countedMomo ?? null, varianceMinor: cash, notes: o.notes ?? null,
      }).returning({ id: cashUps.id });
      await audit(t, ctx, "create", "cash_up", row.id, { details: { day: o.day, variance: cash, momoVariance: momo } });
      return cash;
    });
    revalidatePath("/cashup");
    return { ok: true, message: v === 0 ? "Day closed. The drawer balances." : `Day closed. Cash is ${v < 0 ? "short" : "over"} by ${money(Math.abs(v), ctx.tenant.currency)}.` };
  });
}
