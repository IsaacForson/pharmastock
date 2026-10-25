import "server-only";
import { and, eq, gte, lt } from "drizzle-orm";
import type { Tx } from "@/db";
import { expenses, payments, sales } from "@/db/schema";
import { summarizeDay } from "@/lib/cashup";
import { dayRange } from "@/lib/format";

/** The day's figures for one branch, as the daily close sees them. */
export async function daySummary(t: Tx, branchId: string, day: string, tz: string) {
  const { start, end } = dayRange(day, tz);
  const pays = await t.select({ method: payments.method, amountMinor: payments.amountMinor, status: payments.status, saleId: payments.saleId, receivedBy: payments.receivedBy })
    .from(payments).where(and(eq(payments.branchId, branchId), gte(payments.receivedAt, start), lt(payments.receivedAt, end)));
  const sold = await t.select({ status: sales.status, totalMinor: sales.totalMinor, creditMinor: sales.creditMinor, payerPortionMinor: sales.payerPortionMinor, cashierId: sales.cashierId, offline: sales.offline })
    .from(sales).where(and(eq(sales.branchId, branchId), gte(sales.soldAt, start), lt(sales.soldAt, end)));
  const spent = await t.select({ method: expenses.method, amountMinor: expenses.amountMinor }).from(expenses).where(and(eq(expenses.branchId, branchId), eq(expenses.day, day)));
  return summarizeDay({ payments: pays, sales: sold, expenses: spent });
}
