/**
 * Insurance / HMO / corporate claims: sales with a payer share are batched per payer and period, submitted (print + CSV),
 * then settled item by item. Settlement amounts are recorded as `insurance` payments on the sale so they show in reports
 * but never in a cash drawer.
 */
import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { claimItems, claims, customers, payers, payments, saleLines, sales } from "@/db/schema";
import { UserError } from "./action";
import { audit, type Ctx } from "./auth";
import { dayRange } from "./format";
import { nextNumber } from "./numbers";

export type ItemStatus = "pending" | "paid" | "partially_paid" | "rejected";
type ClaimStatus = (typeof claims.$inferSelect)["status"];

/** Payer share still owed after returns (the payer only pays for what the customer kept). */
export function claimableAmount(sale: { totalMinor: number; payerPortionMinor: number }, returnedValueMinor: number) {
  if (!sale.totalMinor || !sale.payerPortionMinor) return 0;
  const kept = Math.max(0, sale.totalMinor - returnedValueMinor);
  return Math.round((sale.payerPortionMinor * kept) / sale.totalMinor);
}

export function itemStatus(claimed: number, paid: number, rejected: boolean): ItemStatus {
  if (rejected && paid <= 0) return "rejected";
  if (paid <= 0) return "pending";
  return paid >= claimed ? "paid" : "partially_paid";
}

/** Batch status from its items. Draft until submitted; then by what has been settled. */
export function claimStatus(submitted: boolean, items: { status: string; amountPaidMinor: number }[]): ClaimStatus {
  if (!submitted) return "draft";
  if (!items.length || items.every((i) => i.status === "pending")) return "submitted";
  if (items.every((i) => i.status === "rejected")) return "rejected";
  if (items.every((i) => i.status === "paid" || i.status === "rejected")) return items.some((i) => i.status === "paid") ? "paid" : "rejected";
  return items.some((i) => i.amountPaidMinor > 0) ? "partially_paid" : "submitted";
}

const csvCell = (v: string | number | null | undefined) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Sales with an outstanding payer share that are not yet in a claim, optionally for one payer and local-day period. */
export async function awaitingClaim(t: Tx, tz: string, o: { payerId?: string; from?: string; to?: string } = {}) {
  const conds = [sql`${sales.payerPortionMinor} > 0`, ne(sales.status, "voided"), ne(sales.status, "returned"), isNull(claimItems.id)];
  if (o.payerId) conds.push(eq(sales.payerId, o.payerId));
  if (o.from) conds.push(gte(sales.soldAt, dayRange(o.from, tz).start));
  if (o.to) conds.push(lt(sales.soldAt, dayRange(o.to, tz).end));
  const rows = await t.select({ sale: sales, payer: payers.name, customer: customers.name })
    .from(sales).innerJoin(payers, eq(payers.id, sales.payerId)).leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(claimItems, eq(claimItems.saleId, sales.id)).where(and(...conds)).orderBy(sales.soldAt);
  if (!rows.length) return [];
  const returned = await returnedValues(t, rows.map((r) => r.sale.id));
  return rows.map((r) => ({ ...r, claimable: claimableAmount(r.sale, returned.get(r.sale.id) ?? 0) })).filter((r) => r.claimable > 0);
}

async function returnedValues(t: Tx, saleIds: string[]) {
  const lines = await t.select({ saleId: saleLines.saleId, totalMinor: saleLines.totalMinor, baseQty: saleLines.baseQty, returned: saleLines.returnedBaseQty })
    .from(saleLines).where(and(inArray(saleLines.saleId, saleIds), sql`${saleLines.returnedBaseQty} > 0`));
  const m = new Map<string, number>();
  for (const l of lines) m.set(l.saleId, (m.get(l.saleId) ?? 0) + Math.round((l.totalMinor * l.returned) / Math.max(1, l.baseQty)));
  return m;
}

/** Creates a draft claim batch for a payer and period from every sale awaiting a claim. */
export async function createClaim(t: Tx, ctx: Ctx, o: { payerId: string; from: string; to: string }) {
  if (o.from > o.to) throw new UserError("The period ends before it starts");
  const rows = await awaitingClaim(t, ctx.tenant.timezone, o);
  if (!rows.length) throw new UserError("No sales are waiting to be claimed from this payer in that period");
  const batchNo = await nextNumber(t, ctx.tenant.id, "claim");
  const total = rows.reduce((s, r) => s + r.claimable, 0);
  const [claim] = await t.insert(claims).values({
    tenantId: ctx.tenant.id, payerId: o.payerId, batchNo, periodStart: o.from, periodEnd: o.to, totalClaimedMinor: total, createdBy: ctx.user.id,
  }).returning();
  await t.insert(claimItems).values(rows.map((r) => ({ tenantId: ctx.tenant.id, claimId: claim.id, saleId: r.sale.id, amountClaimedMinor: r.claimable })));
  await audit(t, ctx, "create", "claim", claim.id, { details: { batchNo, items: rows.length, total } });
  return claim;
}

export async function submitClaim(t: Tx, ctx: Ctx, claimId: string) {
  const [c] = await t.select().from(claims).where(eq(claims.id, claimId)).for("update");
  if (!c) throw new UserError("Claim not found");
  if (c.status !== "draft") throw new UserError("This claim was already submitted");
  await t.update(claims).set({ status: "submitted", submittedAt: new Date() }).where(eq(claims.id, c.id));
  await audit(t, ctx, "update", "claim", c.id, { details: { status: "submitted" } });
}

/** Removes a sale from a draft claim (it goes back to "awaiting claim"). */
export async function removeClaimItem(t: Tx, ctx: Ctx, itemId: string) {
  const [i] = await t.select({ item: claimItems, claim: claims }).from(claimItems).innerJoin(claims, eq(claims.id, claimItems.claimId)).where(eq(claimItems.id, itemId));
  if (!i) throw new UserError("Item not found");
  if (i.claim.status !== "draft") throw new UserError("Only draft claims can be changed");
  await t.delete(claimItems).where(eq(claimItems.id, itemId));
  await t.update(claims).set({ totalClaimedMinor: sql`${claims.totalClaimedMinor} - ${i.item.amountClaimedMinor}` }).where(eq(claims.id, i.claim.id));
  await audit(t, ctx, "update", "claim", i.claim.id, { details: { removedSale: i.item.saleId } });
}

/**
 * Records what the payer paid (or rejected) for one sale. Changes are recorded as the difference, so correcting a
 * settlement never double-counts. The claim's totals and status follow.
 */
export async function settleClaimItem(t: Tx, ctx: Ctx, o: { itemId: string; paidMinor: number; rejected?: boolean; reason?: string | null }) {
  const [row] = await t.select({ item: claimItems, claim: claims, sale: sales }).from(claimItems)
    .innerJoin(claims, eq(claims.id, claimItems.claimId)).innerJoin(sales, eq(sales.id, claimItems.saleId))
    .where(eq(claimItems.id, o.itemId)).for("update", { of: claimItems });
  if (!row) throw new UserError("Item not found");
  if (row.claim.status === "draft") throw new UserError("Submit the claim before recording payment");
  if (o.paidMinor < 0) throw new UserError("Amount can't be negative");
  if (o.paidMinor > row.item.amountClaimedMinor) throw new UserError("Paid is more than was claimed");
  if (o.rejected && !o.reason?.trim()) throw new UserError("Give the payer's reason for rejecting");
  const status = itemStatus(row.item.amountClaimedMinor, o.paidMinor, !!o.rejected);
  const delta = o.paidMinor - row.item.amountPaidMinor;
  await t.update(claimItems).set({ amountPaidMinor: o.paidMinor, status, rejectionReason: o.rejected ? o.reason!.trim() : null }).where(eq(claimItems.id, o.itemId));
  if (delta) {
    await t.insert(payments).values({
      tenantId: ctx.tenant.id, branchId: row.sale.branchId, saleId: row.sale.id, amountMinor: delta, method: "insurance",
      provider: "manual", reference: `Claim ${row.claim.batchNo}`, receivedBy: ctx.user.id,
    });
  }
  const items = await t.select({ status: claimItems.status, amountPaidMinor: claimItems.amountPaidMinor }).from(claimItems).where(eq(claimItems.claimId, row.claim.id));
  await t.update(claims).set({
    totalPaidMinor: items.reduce((s, i) => s + i.amountPaidMinor, 0), status: claimStatus(true, items),
  }).where(eq(claims.id, row.claim.id));
  await audit(t, ctx, "update", "claim_item", o.itemId, { customerId: row.sale.customerId, details: { claim: row.claim.batchNo, paid: o.paidMinor, status, reason: o.reason ?? undefined } });
  return status;
}
