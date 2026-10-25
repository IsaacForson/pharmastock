import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { products, stockBatches, suppliers } from "@/db/schema";
import { addDays, localDay } from "./format";

/**
 * Returns calendar: for each batch on the shelf, the supplier it came from and the last day that supplier still takes it
 * back. Supplier terms: stock must have at least `returnMinDaysToExpiry` days left, and (when set) be returned within
 * `returnWithinDaysOfDelivery` days of delivery. The deadline is the earlier of the two.
 */

export type ReturnTerms = { returnMinDaysToExpiry: number; returnWithinDaysOfDelivery: number };

/** Pure: last day (YYYY-MM-DD) a batch can still be returned, or null when the terms set no limit. */
export function returnDeadline(b: { expiry: string | null; receivedDay: string }, s: ReturnTerms): string | null {
  const byExpiry = b.expiry ? addDays(b.expiry, -s.returnMinDaysToExpiry) : null;
  const byDelivery = s.returnWithinDaysOfDelivery > 0 ? addDays(b.receivedDay, s.returnWithinDaysOfDelivery) : null;
  if (byExpiry && byDelivery) return byExpiry < byDelivery ? byExpiry : byDelivery;
  return byExpiry ?? byDelivery;
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

export type CalendarBatch = {
  batchId: string; productId: string; productName: string; batchNo: string; expiry: string | null; receivedDay: string;
  qty: number; unitCostMinor: number; supplierId: string; supplierName: string; terms: ReturnTerms; quarantined?: boolean;
};
export type CalendarEntry = CalendarBatch & { deadline: string; daysLeft: number; valueMinor: number; urgency: "missed" | "this_week" | "soon" | "later" };
export type CalendarGroup = { supplierId: string; supplierName: string; valueMinor: number; nextDeadline: string; entries: CalendarEntry[] };

/** Pure: entries with a deadline, grouped by supplier, earliest deadline first. Missed ones only with includeMissed. */
export function buildReturnsCalendar(batches: CalendarBatch[], today: string, o: { includeMissed?: boolean; soonDays?: number } = {}): CalendarGroup[] {
  const soon = o.soonDays ?? 30;
  const groups = new Map<string, CalendarGroup>();
  for (const b of batches) {
    if (b.qty <= 0) continue;
    const deadline = returnDeadline(b, b.terms);
    if (!deadline) continue;
    const daysLeft = daysBetween(today, deadline);
    if (daysLeft < 0 && !o.includeMissed) continue;
    const urgency = daysLeft < 0 ? "missed" : daysLeft <= 7 ? "this_week" : daysLeft <= soon ? "soon" : "later";
    const entry: CalendarEntry = { ...b, deadline, daysLeft, urgency, valueMinor: Math.round(b.qty * b.unitCostMinor) };
    const g = groups.get(b.supplierId) ?? { supplierId: b.supplierId, supplierName: b.supplierName, valueMinor: 0, nextDeadline: deadline, entries: [] };
    g.entries.push(entry);
    g.valueMinor += entry.valueMinor;
    if (deadline < g.nextDeadline) g.nextDeadline = deadline;
    groups.set(b.supplierId, g);
  }
  for (const g of groups.values()) g.entries.sort((a, b) => a.deadline.localeCompare(b.deadline));
  return [...groups.values()].sort((a, b) => a.nextDeadline.localeCompare(b.nextDeadline));
}

/** Batches in stock at a branch that came from a known supplier, in the shape the calendar needs. */
export async function calendarBatches(t: Tx, branchId: string, tz: string): Promise<CalendarBatch[]> {
  const rows = await t.select({ b: stockBatches, productName: products.name, strength: products.strength, s: suppliers })
    .from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId)).innerJoin(suppliers, eq(suppliers.id, stockBatches.supplierId))
    .where(and(eq(stockBatches.branchId, branchId), gt(stockBatches.qtyOnHand, 0), isNotNull(stockBatches.supplierId)));
  return rows.map(({ b, s, productName, strength }) => ({
    batchId: b.id, productId: b.productId, productName: strength ? `${productName} ${strength}` : productName, batchNo: b.batchNo, expiry: b.expiry,
    receivedDay: localDay(tz, b.receivedAt), qty: b.qtyOnHand, unitCostMinor: b.unitCostMinor, supplierId: s.id, supplierName: s.name,
    terms: { returnMinDaysToExpiry: s.returnMinDaysToExpiry, returnWithinDaysOfDelivery: s.returnWithinDaysOfDelivery }, quarantined: b.quarantined,
  }));
}
