import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  alerts, customerLedger, customers, loyaltyEntries, payers, payments, prescriptionItems, prescriptions, productUnits, products,
  saleLines, saleReturns, sales, users, type BatchAllocation,
} from "@/db/schema";
import { UserError } from "./action";
import type { Ctx } from "./auth";
import { audit } from "./auth";
import { NEEDS_PHARMACIST, NEEDS_PRESCRIPTION } from "./compliance";
import { verifyPassword } from "./crypto";
import { emit } from "./events";
import { addDays, localDay, money } from "./format";
import { nextNumber } from "./numbers";
import { can } from "./permissions";
import { hasFeature } from "./plans";
import { loyaltyEarned, saleTotals } from "./pos-math";
import { returnToBatch, takeFefo } from "./stock";

/** A sale as the till sends it. Validated here, at the trust boundary, for the POS action, offline sync and the API. */
export const saleInput = z.object({
  clientId: z.string().min(8).max(100),
  customerId: z.uuid().nullish(),
  prescriptionId: z.uuid().nullish(),
  payerId: z.uuid().nullish(),
  memberNo: z.string().max(60).nullish(),
  lines: z.array(z.object({
    productId: z.uuid(), unitId: z.uuid(), qty: z.number().int().positive().max(100_000),
    discountMinor: z.number().int().nonnegative().max(1_000_000_000).optional(),
    unitPriceMinor: z.number().int().nonnegative().max(1_000_000_000).optional(), // only honoured with pos.price_override or offline
    prescriptionItemId: z.uuid().nullish(),
  })).min(1).max(200),
  saleDiscountMinor: z.number().int().nonnegative().max(1_000_000_000).default(0),
  payments: z.array(z.object({
    method: z.enum(["cash", "mobile_money", "card", "bank"]), amountMinor: z.number().int().positive().max(1_000_000_000),
    reference: z.string().max(120).nullish(),
  })).max(5).default([]),
  creditMinor: z.number().int().nonnegative().max(1_000_000_000).default(0),
  redeemPoints: z.number().int().nonnegative().max(10_000_000).default(0),
  approverId: z.uuid().nullish(), // pharmacist approving P/POM/CD items sold by a cashier
  approverPin: z.string().max(12).nullish(),
  soldAt: z.iso.datetime().nullish(), // offline sales keep the time they really happened
});
export type SaleInput = z.infer<typeof saleInput>;

/**
 * Records a completed sale: prices, discounts, tax, FEFO stock, payments, credit, loyalty, prescription fills and the
 * controlled-drug register, all in the caller's transaction. Idempotent on clientId. `offline` sales already happened at
 * the counter, so they are never refused for stock: what the books lacked is recorded as a shortfall with an alert.
 */
export async function createSale(t: Tx, ctx: Ctx, raw: SaleInput, opts: { offline?: boolean } = {}) {
  const input = saleInput.parse(raw);
  const offline = !!opts.offline;
  // Offline sales skip checks the till couldn't make without the server; anything they bypassed is flagged for review
  // (an offline op can also be posted by hand, so these must never pass silently).
  const review: string[] = [];
  const [dup] = await t.select().from(sales).where(eq(sales.clientId, input.clientId)).limit(1);
  if (dup) return dup;

  const tenant = ctx.tenant;
  const branchId = ctx.branchId;
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const prodRows = await t.select().from(products).where(inArray(products.id, productIds));
  const unitRows = await t.select().from(productUnits).where(inArray(productUnits.productId, productIds));
  const prod = new Map(prodRows.map((p) => [p.id, p]));
  const unit = new Map(unitRows.map((u) => [u.id, u]));

  // Customer, prescription, payer
  const [customer] = input.customerId ? await t.select().from(customers).where(eq(customers.id, input.customerId)).for("update") : [];
  if (input.customerId && !customer) throw new UserError("Customer not found");
  const [rx] = input.prescriptionId ? await t.select().from(prescriptions).where(eq(prescriptions.id, input.prescriptionId)).for("update") : [];
  if (input.prescriptionId && !rx) throw new UserError("Prescription not found");
  if (rx && rx.status !== "active") throw new UserError(`Prescription ${rx.rxNo} is ${rx.status}`);
  if (rx && customer && rx.customerId !== customer.id) throw new UserError("That prescription belongs to another customer");
  const [payer] = input.payerId ? await t.select().from(payers).where(eq(payers.id, input.payerId)) : [];
  if (input.payerId && !payer) throw new UserError("Insurer not found");

  // Lines: prices, permissions, compliance
  const canOverride = can(ctx.user.role, "pos.price_override");
  const priced = input.lines.map((l, i) => {
    const p = prod.get(l.productId);
    const u = unit.get(l.unitId);
    if (!p || !u || u.productId !== p.id) throw new UserError("A product on this sale no longer exists");
    if (!offline && (!p.active || !u.sellable)) throw new UserError(`${p.name} (${u.name}) is not for sale`);
    const price = l.unitPriceMinor !== undefined && (offline || canOverride) ? l.unitPriceMinor : u.sellPriceMinor;
    if (offline && !canOverride && price !== u.sellPriceMinor) review.push(`${p.name} sold at ${money(price, tenant.currency)} instead of ${money(u.sellPriceMinor, tenant.currency)}`);
    if (offline && (!p.active || !u.sellable)) review.push(`${p.name} (${u.name}) is not for sale`);
    return { key: String(i), l, p, u, unitPriceMinor: price, qty: l.qty, discountMinor: l.discountMinor ?? 0, taxBp: p.taxBp ?? tenant.defaultTaxBp };
  });

  const hasDiscount = input.saleDiscountMinor > 0 || priced.some((x) => x.discountMinor > 0);
  const gross = priced.reduce((s, x) => s + x.unitPriceMinor * x.qty, 0);
  const discountTotal = input.saleDiscountMinor + priced.reduce((s, x) => s + x.discountMinor, 0);
  if (hasDiscount) {
    const problem = !can(ctx.user.role, "pos.discount") ? "You don't have permission to give discounts"
      : gross && discountTotal * 10_000 > gross * ctx.user.maxDiscountBp ? `Discount is above your limit of ${ctx.user.maxDiscountBp / 100}%` : null;
    if (problem && !offline) throw new UserError(problem);
    if (problem) review.push(`${problem} (${money(discountTotal, tenant.currency)} off)`);
  }

  // Pharmacist supervision for P / POM / CD items.
  const supervised = priced.filter((x) => NEEDS_PHARMACIST.has(x.p.schedule));
  let pharmacistId: string | null = null;
  if (supervised.length) {
    if (can(ctx.user.role, "sell.pharmacy")) pharmacistId = ctx.user.id;
    else if (input.approverId) {
      const [ap] = await t.select().from(users).where(and(eq(users.id, input.approverId), eq(users.active, true)));
      if (!ap || !can(ap.role, "sell.pharmacy")) throw new UserError("Approver must be an active pharmacist");
      if (!offline && !(await verifyPassword(input.approverPin ?? "", ap.pinHash))) throw new UserError("Pharmacist PIN is wrong");
      if (offline) review.push(`${ap.name}'s approval for ${supervised.map((x) => x.p.name).join(", ")} was given offline (PIN not checked)`);
      pharmacistId = ap.id;
    } else if (!offline) {
      throw new UserError(`${supervised.map((x) => x.p.name).join(", ")} must be approved by a pharmacist`);
    } else review.push(`${supervised.map((x) => x.p.name).join(", ")} sold without pharmacist approval`);
  }
  const needsRx = priced.filter((x) => NEEDS_PRESCRIPTION.has(x.p.schedule));
  if (needsRx.length && !rx) {
    if (!offline) throw new UserError(`${needsRx.map((x) => x.p.name).join(", ")} needs a prescription on the sale`);
    review.push(`${needsRx.map((x) => x.p.name).join(", ")} sold without a prescription — record it in the register`);
  }
  if (needsRx.length && !hasFeature(tenant, "controlled") && !offline) throw new UserError("Controlled drugs need the Pro plan (controlled-drug register)");

  // Totals
  const totals = saleTotals(priced, input.saleDiscountMinor, tenant.pricesIncludeTax);
  const payerPortion = payer ? Math.round((totals.totalMinor * payer.coverageBp) / 10_000) : 0;
  let redeemPoints = 0, redeemMinor = 0;
  if (input.redeemPoints) {
    if (!customer) throw new UserError("Pick the customer to redeem points");
    if (!tenant.loyaltyEnabled) throw new UserError("Loyalty points are switched off");
    redeemPoints = Math.min(input.redeemPoints, customer.loyaltyPoints);
    redeemMinor = Math.min(redeemPoints * tenant.loyaltyPointValueMinor, totals.totalMinor - payerPortion);
    redeemPoints = tenant.loyaltyPointValueMinor ? Math.ceil(redeemMinor / tenant.loyaltyPointValueMinor) : 0;
  }
  const due = totals.totalMinor - payerPortion - redeemMinor;
  const tendered = input.payments.reduce((s, p) => s + p.amountMinor, 0);
  if (input.creditMinor) {
    if (!customer) throw new UserError("Pick the customer to sell on credit");
    const problem = !can(ctx.user.role, "pos.credit") ? "You don't have permission to sell on credit"
      : customer.balanceMinor + input.creditMinor > customer.creditLimitMinor ? `${customer.name}'s credit limit would be exceeded` : null;
    if (problem && !offline) throw new UserError(problem);
    if (problem) review.push(`${problem} (${money(input.creditMinor, tenant.currency)} on account)`);
  }
  if (tendered + input.creditMinor < due) throw new UserError(`Payment is short by ${money(due - tendered - input.creditMinor, tenant.currency)}`);
  const overpaid = tendered + input.creditMinor - due;
  const cashIn = input.payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amountMinor, 0);
  if (overpaid > cashIn) throw new UserError("Only cash can be overpaid (change is given in cash)");
  const credit = Math.max(0, Math.min(input.creditMinor, due - (tendered - overpaid)));

  // Sale + lines + stock
  const saleNo = await nextNumber(t, tenant.id, "sale");
  const [sale] = await t.insert(sales).values({
    tenantId: tenant.id, branchId, saleNo, customerId: customer?.id ?? null, prescriptionId: rx?.id ?? null,
    payerId: payer?.id ?? null, memberNo: input.memberNo ?? customer?.memberNo ?? null,
    subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, totalMinor: totals.totalMinor,
    payerPortionMinor: payerPortion, paidMinor: tendered - overpaid, creditMinor: credit, changeMinor: overpaid,
    loyaltyRedeemed: redeemPoints, offline, clientId: input.clientId, cashierId: ctx.user.id, pharmacistId,
    soldAt: input.soldAt ? new Date(input.soldAt) : new Date(),
  }).returning();

  let cost = 0, short = 0;
  for (const [i, x] of priced.entries()) {
    const baseQty = x.qty * x.u.factor;
    const register = NEEDS_PRESCRIPTION.has(x.p.schedule) || x.p.schedule === "controlled"
      ? { partyName: customer?.name ?? null, partyAddress: customer?.address ?? null, prescriberName: rx?.prescriberName ?? null, prescriberRegNo: rx?.prescriberRegNo ?? null, rxNo: rx?.rxNo ?? null }
      : undefined;
    const taken = await takeFefo(t, ctx, { productId: x.p.id, branchId, qty: baseQty, type: "sale", ref: saleNo, refId: sale.id, productName: x.p.name, allowShort: offline, register });
    const lt = totals.lines[i];
    cost += taken.costMinor;
    short += taken.short;
    await t.insert(saleLines).values({
      tenantId: tenant.id, saleId: sale.id, productId: x.p.id, unitId: x.u.id,
      description: [x.p.name, x.p.strength, x.u.factor > 1 ? `(${x.u.name})` : null].filter(Boolean).join(" "),
      qty: x.qty, baseQty, unitPriceMinor: x.unitPriceMinor, discountMinor: lt.discountMinor, taxBp: x.taxBp, taxMinor: lt.taxMinor,
      totalMinor: lt.totalMinor, costMinor: taken.costMinor, allocations: taken.allocations satisfies BatchAllocation[],
      shortBaseQty: taken.short, prescriptionItemId: x.l.prescriptionItemId ?? null,
    });
    if (taken.short) {
      await t.insert(alerts).values({
        tenantId: tenant.id, branchId, kind: "stock_discrepancy", productId: x.p.id, title: `${x.p.name}: sold ${taken.short} more than the books had`,
        detail: `Offline sale ${saleNo}. Count this item and correct the stock.`, dueOn: localDay(tenant.timezone), dedupeKey: `short:${sale.id}:${x.p.id}`,
      }).onConflictDoNothing();
    }
  }

  // Payments
  const receiptNo = await nextNumber(t, tenant.id, "receipt");
  let changeLeft = overpaid;
  for (const [i, p] of input.payments.entries()) {
    const keep = p.method === "cash" ? Math.max(0, p.amountMinor - changeLeft) : p.amountMinor;
    if (p.method === "cash") changeLeft -= p.amountMinor - keep;
    if (!keep) continue;
    await t.insert(payments).values({
      tenantId: tenant.id, branchId, saleId: sale.id, customerId: customer?.id ?? null, amountMinor: keep, method: p.method,
      reference: p.reference ?? null, provider: "manual", receiptNo, receivedBy: ctx.user.id, receivedAt: sale.soldAt, clientId: `${input.clientId}:${i}`,
    });
  }
  if (redeemMinor) {
    await t.insert(payments).values({ tenantId: tenant.id, branchId, saleId: sale.id, customerId: customer!.id, amountMinor: redeemMinor, method: "loyalty", receiptNo, receivedBy: ctx.user.id, receivedAt: sale.soldAt });
  }

  // Customer account, loyalty
  let earned = 0;
  if (customer) {
    if (credit) await t.insert(customerLedger).values({ tenantId: tenant.id, customerId: customer.id, amountMinor: credit, kind: "credit_sale", saleId: sale.id, userId: ctx.user.id });
    if (redeemPoints) await t.insert(loyaltyEntries).values({ tenantId: tenant.id, customerId: customer.id, points: -redeemPoints, saleId: sale.id, reason: "redeem" });
    earned = tenant.loyaltyEnabled && hasFeature(tenant, "loyalty") ? loyaltyEarned(tendered - overpaid, tenant.loyaltyEarnPerMajor) : 0;
    if (earned) await t.insert(loyaltyEntries).values({ tenantId: tenant.id, customerId: customer.id, points: earned, saleId: sale.id, reason: "earn" });
    await t.update(customers).set({
      balanceMinor: sql`${customers.balanceMinor} + ${credit}`, loyaltyPoints: sql`${customers.loyaltyPoints} + ${earned - redeemPoints}`,
    }).where(eq(customers.id, customer.id));
  }

  // Prescription fill
  if (rx) {
    for (const x of priced) {
      if (!x.l.prescriptionItemId) continue;
      await t.update(prescriptionItems).set({ qtyDispensed: sql`${prescriptionItems.qtyDispensed} + ${x.qty * x.u.factor}` })
        .where(and(eq(prescriptionItems.id, x.l.prescriptionItemId), eq(prescriptionItems.prescriptionId, rx.id)));
    }
    const used = rx.refillsUsed + 1;
    const today = localDay(tenant.timezone);
    const done = used > rx.refillsAllowed;
    await t.update(prescriptions).set({
      refillsUsed: used, status: done ? "completed" : "active",
      nextRefillDue: !done && rx.refillIntervalDays ? addDays(today, rx.refillIntervalDays) : null,
    }).where(eq(prescriptions.id, rx.id));
  }

  if (review.length) {
    await t.insert(alerts).values({
      tenantId: tenant.id, branchId, kind: "sale_review", title: `Offline sale ${saleNo} needs a manager's review`,
      detail: review.join("; "), valueMinor: totals.totalMinor, dueOn: localDay(tenant.timezone), dedupeKey: `review:${sale.id}`,
    }).onConflictDoNothing();
  }

  const [final] = await t.update(sales).set({ costMinor: cost, shortBaseQty: short, loyaltyEarned: earned }).where(eq(sales.id, sale.id)).returning();
  await audit(t, ctx, "create", "sale", sale.id, { customerId: customer?.id, details: { saleNo, total: totals.totalMinor, offline, short: short || undefined, review: review.length ? review : undefined } });
  await emit(t, tenant.id, "sale.completed", { id: sale.id, saleNo, branchId, totalMinor: final.totalMinor, taxMinor: final.taxMinor, soldAt: final.soldAt, customerId: final.customerId });
  return final;
}

/** Puts a sale line's stock back into the batches it came from (newest-expiry first). Returns base units restocked. */
async function restockLine(t: Tx, ctx: Ctx, line: typeof saleLines.$inferSelect, baseQty: number, ref: string, refId: string, register?: Parameters<typeof returnToBatch>[2]["register"]) {
  // Units sold short never left a batch; earlier returns already went back to the newest allocations.
  let skip = line.returnedBaseQty;
  let left = Math.min(baseQty, line.baseQty - line.shortBaseQty - line.returnedBaseQty);
  for (const a of [...line.allocations].reverse()) {
    if (left <= 0) break;
    const avail = a.qty - Math.min(skip, a.qty);
    skip -= a.qty - avail;
    const qty = Math.min(left, avail);
    if (!qty) continue;
    await returnToBatch(t, ctx, { batchId: a.batchId, qty, type: "sale_return", ref, refId, register });
    left -= qty;
  }
}

/**
 * Customer return of part or all of a sale. Refunds the share of each line's charged total; restock=false writes the
 * goods off (opened or damaged) instead of putting them back on the shelf.
 */
export async function returnSale(t: Tx, ctx: Ctx, o: {
  saleId: string; lines: { saleLineId: string; baseQty: number }[]; reason: string; restock: boolean; refundMethod: "cash" | "mobile_money" | "card" | "bank" | "credit";
}) {
  const [sale] = await t.select().from(sales).where(eq(sales.id, o.saleId)).for("update");
  if (!sale) throw new UserError("Sale not found");
  if (sale.status === "voided" || sale.status === "returned") throw new UserError(`Sale is already ${sale.status}`);
  const lines = await t.select().from(saleLines).where(eq(saleLines.saleId, sale.id));
  const returnNo = await nextNumber(t, ctx.tenant.id, "return");
  const done: { saleLineId: string; baseQty: number; refundMinor: number }[] = [];
  for (const r of o.lines) {
    const line = lines.find((l) => l.id === r.saleLineId);
    if (!line || r.baseQty <= 0) continue;
    const left = line.baseQty - line.returnedBaseQty;
    if (r.baseQty > left) throw new UserError(`Only ${left} of ${line.description} can still be returned`);
    const refund = Math.round((line.totalMinor * r.baseQty) / line.baseQty);
    if (o.restock) await restockLine(t, ctx, line, r.baseQty, returnNo, sale.id);
    await t.update(saleLines).set({ returnedBaseQty: line.returnedBaseQty + r.baseQty }).where(eq(saleLines.id, line.id));
    line.returnedBaseQty += r.baseQty;
    done.push({ saleLineId: line.id, baseQty: r.baseQty, refundMinor: refund });
  }
  if (!done.length) throw new UserError("Choose what is being returned");
  // The payer's share isn't refunded to the customer; only what the customer paid for these lines.
  const customerShare = sale.totalMinor ? (sale.totalMinor - sale.payerPortionMinor) / sale.totalMinor : 0;
  const refund = Math.round(done.reduce((s, d) => s + d.refundMinor, 0) * customerShare);
  await t.insert(saleReturns).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, saleId: sale.id, returnNo, reason: o.reason, restock: o.restock, refundMinor: refund, refundMethod: o.refundMethod, lines: done, createdBy: ctx.user.id });
  if (refund) {
    if (o.refundMethod === "credit") {
      if (!sale.customerId) throw new UserError("Only sales to a named customer can be refunded to their account");
      await t.insert(customerLedger).values({ tenantId: ctx.tenant.id, customerId: sale.customerId, amountMinor: -refund, kind: "return", saleId: sale.id, userId: ctx.user.id, note: returnNo });
      await t.update(customers).set({ balanceMinor: sql`${customers.balanceMinor} - ${refund}` }).where(eq(customers.id, sale.customerId));
    } else {
      await t.insert(payments).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, saleId: sale.id, amountMinor: -refund, method: o.refundMethod, receiptNo: returnNo, receivedBy: ctx.user.id, provider: "manual", reference: `Refund ${returnNo}` });
    }
  }
  if (sale.customerId && sale.loyaltyEarned) {
    const back = Math.round((sale.loyaltyEarned * refund) / Math.max(1, sale.paidMinor));
    if (back) {
      await t.insert(loyaltyEntries).values({ tenantId: ctx.tenant.id, customerId: sale.customerId, points: -back, saleId: sale.id, reason: "return" });
      await t.update(customers).set({ loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} - ${back})` }).where(eq(customers.id, sale.customerId));
    }
  }
  const all = lines.every((l) => l.returnedBaseQty >= l.baseQty);
  await t.update(sales).set({ status: all ? "returned" : "partially_returned", paidMinor: sale.paidMinor - (o.refundMethod === "credit" ? 0 : refund) }).where(eq(sales.id, sale.id));
  await audit(t, ctx, "return", "sale", sale.id, { customerId: sale.customerId, details: { returnNo, refund, restock: o.restock } });
  await emit(t, ctx.tenant.id, "sale.returned", { id: sale.id, saleNo: sale.saleNo, returnNo, refundMinor: refund });
  return { returnNo, refundMinor: refund };
}

/** Cancels a whole sale made today (mistakes at the till): stock, payments, credit and points all reversed. */
export async function voidSale(t: Tx, ctx: Ctx, o: { saleId: string; reason: string }) {
  const [sale] = await t.select().from(sales).where(eq(sales.id, o.saleId)).for("update");
  if (!sale) throw new UserError("Sale not found");
  if (sale.status !== "completed") throw new UserError("Only untouched sales can be voided; use a return instead");
  if (localDay(ctx.tenant.timezone, sale.soldAt) !== localDay(ctx.tenant.timezone)) throw new UserError("Only today's sales can be voided; use a return instead");
  for (const line of await t.select().from(saleLines).where(eq(saleLines.saleId, sale.id))) {
    await restockLine(t, ctx, line, line.baseQty, sale.saleNo, sale.id, { note: `Void: ${o.reason}` });
  }
  await t.update(payments).set({ status: "refunded", refundedAt: new Date(), refundedBy: ctx.user.id, refundReason: o.reason })
    .where(and(eq(payments.saleId, sale.id), eq(payments.status, "succeeded")));
  if (sale.customerId) {
    if (sale.creditMinor) await t.insert(customerLedger).values({ tenantId: ctx.tenant.id, customerId: sale.customerId, amountMinor: -sale.creditMinor, kind: "return", saleId: sale.id, userId: ctx.user.id, note: "Void" });
    const pts = sale.loyaltyRedeemed - sale.loyaltyEarned;
    if (pts) await t.insert(loyaltyEntries).values({ tenantId: ctx.tenant.id, customerId: sale.customerId, points: pts, saleId: sale.id, reason: "adjust" });
    await t.update(customers).set({ balanceMinor: sql`${customers.balanceMinor} - ${sale.creditMinor}`, loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} + ${pts})` }).where(eq(customers.id, sale.customerId));
  }
  if (sale.prescriptionId) {
    await t.update(prescriptions).set({ refillsUsed: sql`greatest(0, ${prescriptions.refillsUsed} - 1)`, status: "active" }).where(eq(prescriptions.id, sale.prescriptionId));
  }
  await t.update(sales).set({ status: "voided", voidReason: o.reason, voidedBy: ctx.user.id, paidMinor: 0, creditMinor: 0 }).where(eq(sales.id, sale.id));
  await audit(t, ctx, "void", "sale", sale.id, { customerId: sale.customerId, details: { reason: o.reason, total: sale.totalMinor } });
  await emit(t, ctx.tenant.id, "sale.voided", { id: sale.id, saleNo: sale.saleNo, reason: o.reason });
}

/** Customer pays down their account balance. */
export async function recordRepayment(t: Tx, ctx: Ctx, o: { customerId: string; amountMinor: number; method: "cash" | "mobile_money" | "card" | "bank"; reference?: string | null; clientId?: string | null }) {
  if (o.amountMinor <= 0) throw new UserError("Enter an amount");
  if (o.clientId) {
    const [dup] = await t.select().from(payments).where(eq(payments.clientId, o.clientId));
    if (dup) return dup;
  }
  const [c] = await t.select().from(customers).where(eq(customers.id, o.customerId)).for("update");
  if (!c) throw new UserError("Customer not found");
  if (o.amountMinor > c.balanceMinor) throw new UserError(`${c.name} only owes ${money(c.balanceMinor, ctx.tenant.currency)}`);
  const receiptNo = await nextNumber(t, ctx.tenant.id, "receipt");
  const [p] = await t.insert(payments).values({
    tenantId: ctx.tenant.id, branchId: ctx.branchId, customerId: c.id, amountMinor: o.amountMinor, method: o.method, reference: o.reference ?? null,
    provider: "manual", receiptNo, receivedBy: ctx.user.id, clientId: o.clientId ?? null,
  }).returning();
  await t.insert(customerLedger).values({ tenantId: ctx.tenant.id, customerId: c.id, amountMinor: -o.amountMinor, kind: "repayment", paymentId: p.id, userId: ctx.user.id });
  await t.update(customers).set({ balanceMinor: sql`${customers.balanceMinor} - ${o.amountMinor}` }).where(eq(customers.id, c.id));
  await audit(t, ctx, "create", "payment", p.id, { customerId: c.id, details: { repayment: o.amountMinor } });
  await emit(t, ctx.tenant.id, "payment.received", { id: p.id, customerId: c.id, amountMinor: o.amountMinor, method: o.method, receiptNo });
  return p;
}
