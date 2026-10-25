import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { productUnits, products, purchaseOrderLines, purchaseOrders, saleLines, sales, stockBatches, supplierPrices, suppliers } from "@/db/schema";
import { addDays, dayRange, localDay } from "./format";

export const VELOCITY_DAYS = 56;

export type ReorderSuggestion = {
  productId: string; name: string; strength: string | null; baseUnit: string;
  onHand: number; onOrder: number; dailyDemand: number; daysOfCover: number | null;
  suggestBaseQty: number; unitId: string | null; unitName: string; unitFactor: number; packs: number;
  supplierId: string | null; supplierName: string | null; unitCostMinor: number | null; estCostMinor: number | null;
  reason: "below_reorder_level" | "low_cover" | "out_of_stock";
};

/**
 * Pure: how much to order. Target = demand over (lead time + cover days); order enough to reach it, at least the
 * product's reorder quantity, rounded up to whole packs. 0 when stock + open orders already cover it.
 */
export function suggestQty(o: { onHand: number; onOrder: number; dailyDemand: number; leadTimeDays: number; coverDays: number; reorderLevel: number; reorderQty: number; packFactor: number }) {
  const target = Math.ceil(o.dailyDemand * (o.leadTimeDays + o.coverDays));
  const position = o.onHand + o.onOrder;
  const needs = position <= o.reorderLevel || position < target;
  if (!needs || (o.dailyDemand === 0 && o.reorderLevel === 0)) return 0;
  const want = Math.max(target - position, o.reorderQty, o.reorderLevel > 0 ? o.reorderLevel * 2 - position : 0, 1);
  return Math.ceil(want / o.packFactor) * o.packFactor;
}

/**
 * Reorder list for one branch: products below their reorder level or with less cover than lead time + cover days, from
 * net sales over the last VELOCITY_DAYS. `seasonal` multiplies a product's demand (from @/lib/forecast) when given.
 */
export async function reorderSuggestions(t: Tx, o: {
  tenant: { id: string; timezone: string; reorderCoverDays: number }; branchId: string; seasonal?: Map<string, number>; supplierId?: string;
}): Promise<ReorderSuggestion[]> {
  const today = localDay(o.tenant.timezone);
  const since = dayRange(addDays(today, -VELOCITY_DAYS), o.tenant.timezone).start;

  const prods = await t.select().from(products).where(and(eq(products.tenantId, o.tenant.id), eq(products.active, true)));
  if (!prods.length) return [];
  const stock = await t.select({ productId: stockBatches.productId, n: sql<number>`coalesce(sum(${stockBatches.qtyOnHand}) filter (where ${stockBatches.quarantined} = false and (${stockBatches.expiry} is null or ${stockBatches.expiry} >= ${today})), 0)::int` })
    .from(stockBatches).where(eq(stockBatches.branchId, o.branchId)).groupBy(stockBatches.productId);
  const sold = await t.select({ productId: saleLines.productId, n: sql<number>`sum(${saleLines.baseQty} - ${saleLines.returnedBaseQty})::int` })
    .from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(eq(sales.branchId, o.branchId), ne(sales.status, "voided"), gte(sales.soldAt, since))).groupBy(saleLines.productId);
  const ordered = await t.select({ productId: purchaseOrderLines.productId, n: sql<number>`sum(${purchaseOrderLines.qty} * ${productUnits.factor} - ${purchaseOrderLines.receivedBaseQty})::int` })
    .from(purchaseOrderLines).innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.poId)).innerJoin(productUnits, eq(productUnits.id, purchaseOrderLines.unitId))
    .where(and(eq(purchaseOrders.branchId, o.branchId), inArray(purchaseOrders.status, ["draft", "sent", "confirmed", "partially_received"]))).groupBy(purchaseOrderLines.productId);
  const units = await t.select().from(productUnits);
  const prices = await t.select({ sp: supplierPrices, supplierName: suppliers.name, lead: suppliers.leadTimeDays }).from(supplierPrices).innerJoin(suppliers, eq(suppliers.id, supplierPrices.supplierId)).where(eq(suppliers.active, true));
  const sups = await t.select().from(suppliers).where(eq(suppliers.active, true));

  const onHandOf = new Map(stock.map((r) => [r.productId, r.n]));
  const soldOf = new Map(sold.map((r) => [r.productId, r.n]));
  const orderedOf = new Map(ordered.map((r) => [r.productId, Math.max(0, r.n)]));

  const out: ReorderSuggestion[] = [];
  for (const p of prods) {
    const onHand = onHandOf.get(p.id) ?? 0;
    const onOrder = orderedOf.get(p.id) ?? 0;
    const dailyDemand = ((soldOf.get(p.id) ?? 0) / VELOCITY_DAYS) * (o.seasonal?.get(p.id) ?? 1);
    // Cheapest known supplier price, preferring the product's preferred supplier.
    const quotes = prices.filter((x) => x.sp.productId === p.id && (!o.supplierId || x.sp.supplierId === o.supplierId));
    const pick = quotes.find((x) => x.sp.supplierId === p.preferredSupplierId)
      ?? quotes.sort((a, b) => a.sp.costMinor / (units.find((u) => u.id === a.sp.unitId)?.factor ?? 1) - b.sp.costMinor / (units.find((u) => u.id === b.sp.unitId)?.factor ?? 1))[0];
    if (o.supplierId && !pick && p.preferredSupplierId !== o.supplierId) continue;
    const supplierId = pick?.sp.supplierId ?? p.preferredSupplierId ?? null;
    const sup = sups.find((s) => s.id === supplierId);
    const pUnits = units.filter((u) => u.productId === p.id);
    const unit = (pick && pUnits.find((u) => u.id === pick.sp.unitId)) ?? pUnits.sort((a, b) => b.factor - a.factor)[0];
    const factor = unit?.factor ?? 1;
    const qty = suggestQty({ onHand, onOrder, dailyDemand, leadTimeDays: sup?.leadTimeDays ?? 3, coverDays: o.tenant.reorderCoverDays, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty, packFactor: factor });
    if (!qty) continue;
    const packs = qty / factor;
    out.push({
      productId: p.id, name: p.name, strength: p.strength, baseUnit: p.baseUnit, onHand, onOrder, dailyDemand,
      daysOfCover: dailyDemand > 0 ? (onHand + onOrder) / dailyDemand : null,
      suggestBaseQty: qty, unitId: unit?.id ?? null, unitName: unit?.name ?? p.baseUnit, unitFactor: factor, packs,
      supplierId, supplierName: sup?.name ?? null, unitCostMinor: pick?.sp.costMinor ?? null,
      estCostMinor: pick ? pick.sp.costMinor * packs : null,
      reason: onHand === 0 ? "out_of_stock" : onHand + onOrder <= p.reorderLevel ? "below_reorder_level" : "low_cover",
    });
  }
  return out.sort((a, b) => (a.daysOfCover ?? -1) - (b.daysOfCover ?? -1));
}
