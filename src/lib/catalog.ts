import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { outer, type Tx } from "@/db";
import { barcodes, priceChanges, productUnits, products, stockBatches, type Product, type ProductUnit } from "@/db/schema";
import type { Ctx } from "./auth";
import { audit } from "./auth";

/** "Today" in the tenant's timezone, evaluated in SQL (RLS limits `tenants` to the current tenant). */
export const sqlToday = sql`(now() at time zone (select timezone from tenants limit 1))::date`;

/** SQL condition: batch is sellable (in stock, unexpired, not quarantined). */
export const sellableBatch = sql`${stockBatches.qtyOnHand} > 0 and not ${stockBatches.quarantined} and (${stockBatches.expiry} is null or ${stockBatches.expiry} >= ${sqlToday})`;

/** Product + unit for a scanned code (exact match, per tenant). */
export async function findByBarcode(t: Tx, code: string): Promise<{ product: Product; unit: ProductUnit } | null> {
  const c = code.trim();
  if (!c) return null;
  const [r] = await t.select({ product: products, unit: productUnits }).from(barcodes)
    .innerJoin(products, eq(products.id, barcodes.productId)).innerJoin(productUnits, eq(productUnits.id, barcodes.unitId))
    .where(eq(barcodes.code, c)).limit(1);
  return r ?? null;
}

/**
 * Active products matching name / generic name / strength or an exact barcode, with all units (default first) and
 * sellable stock at the branch. Results with stock come first, then by name.
 */
export async function searchProducts(t: Tx, q: string, branchId: string, limit = 20): Promise<{ product: Product; units: ProductUnit[]; onHand: number; nextExpiry: string | null }[]> {
  const term = q.trim().slice(0, 80);
  if (!term) return [];
  const like = `%${term.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const stock = t.select({
    productId: stockBatches.productId,
    qty: sql<number>`coalesce(sum(${stockBatches.qtyOnHand}), 0)::int`.as("qty"),
    next: sql<string | null>`min(${stockBatches.expiry})::text`.as("next"),
  }).from(stockBatches).where(and(eq(stockBatches.branchId, branchId), sellableBatch)).groupBy(stockBatches.productId).as("s");
  const rows = await t.select({ product: products, onHand: sql<number>`coalesce(${stock.qty}, 0)::int`, nextExpiry: stock.next })
    .from(products).leftJoin(stock, eq(stock.productId, products.id))
    .where(and(eq(products.active, true), or(
      ilike(products.name, like), ilike(products.genericName, like),
      ilike(sql`${products.name} || ' ' || coalesce(${products.strength}, '')`, like),
      sql`exists (select 1 from ${barcodes} where ${barcodes.productId} = ${outer(products.id)} and ${barcodes.code} = ${term})`,
    )))
    .orderBy(sql`coalesce(${stock.qty}, 0) = 0`, sql`${products.name} ilike ${term.replace(/[%_\\]/g, (m) => "\\" + m) + "%"} desc`, asc(products.name))
    .limit(limit);
  if (!rows.length) return [];
  const units = await t.select().from(productUnits).where(inArray(productUnits.productId, rows.map((r) => r.product.id)))
    .orderBy(sql`${productUnits.isDefault} desc`, asc(productUnits.factor));
  return rows.map((r) => ({ product: r.product, units: units.filter((u) => u.productId === r.product.id), onHand: Number(r.onHand), nextExpiry: r.nextExpiry ?? null }));
}

/** Changes a unit's selling price with a price_changes row and an audit entry. Caller emits product.updated. */
export async function setUnitPrice(t: Tx, ctx: Ctx, unit: Pick<ProductUnit, "id" | "productId" | "sellPriceMinor">, newPriceMinor: number) {
  if (unit.sellPriceMinor === newPriceMinor) return false;
  await t.update(productUnits).set({ sellPriceMinor: newPriceMinor }).where(eq(productUnits.id, unit.id));
  await t.insert(priceChanges).values({ tenantId: ctx.tenant.id, productId: unit.productId, unitId: unit.id, oldPriceMinor: unit.sellPriceMinor, newPriceMinor, changedBy: ctx.user.id });
  await audit(t, ctx, "price_change", "product", unit.productId, { details: { unitId: unit.id, from: unit.sellPriceMinor, to: newPriceMinor } });
  return true;
}

// ---------- Pure display helpers (server + client) ----------

/** "3 boxes + 12 tablets" style: largest pack first. `units` need name + factor. */
export function packs(qty: number, units: { name: string; factor: number }[], baseUnit = "unit"): string {
  if (!qty) return `0 ${baseUnit}`;
  const big = [...units].filter((u) => u.factor > 1).sort((a, b) => b.factor - a.factor)[0];
  if (!big || Math.abs(qty) < big.factor) return `${qty} ${baseUnit}`;
  const sign = qty < 0 ? "-" : "";
  const n = Math.floor(Math.abs(qty) / big.factor), rest = Math.abs(qty) % big.factor;
  return `${sign}${n} ${big.name}${rest ? ` + ${rest} ${baseUnit}` : ""}`;
}

export type ExpiryState = "expired" | "30" | "60" | "90" | "ok" | "none";
/** Days from today (YYYY-MM-DD) to expiry; negative = expired. */
export const daysTo = (expiry: string, today: string) => Math.round((Date.parse(expiry) - Date.parse(today)) / 86400_000);
export function expiryState(expiry: string | null, today: string): ExpiryState {
  if (!expiry) return "none";
  const d = daysTo(expiry, today);
  return d < 0 ? "expired" : d <= 30 ? "30" : d <= 60 ? "60" : d <= 90 ? "90" : "ok";
}
export const EXPIRY_BADGE: Record<ExpiryState, { tone: "red" | "yellow" | "blue" | "green" | "gray"; word: string }> = {
  expired: { tone: "red", word: "Expired" }, "30": { tone: "red", word: "Under 30 days" }, "60": { tone: "yellow", word: "Under 60 days" },
  "90": { tone: "blue", word: "Under 90 days" }, ok: { tone: "green", word: "In date" }, none: { tone: "gray", word: "No expiry" },
};
