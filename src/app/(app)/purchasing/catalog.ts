import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import type { Tx } from "@/db";
import { barcodes, productUnits, products, stockBatches, supplierPrices } from "@/db/schema";

export type CatalogUnit = { id: string; name: string; factor: number; isDefault: boolean };
export type CatalogItem = {
  id: string; name: string; genericName: string | null; strength: string | null; form: string | null; schedule: string; baseUnit: string; units: CatalogUnit[]; codes: { code: string; unitId: string }[];
  prices: { supplierId: string; unitId: string; costMinor: number }[];
  /** Cost per base unit of the most recently received batch (for cost-jump warnings). */
  lastCostPerBase: number | null;
  /** Batches already at this branch, for batch/expiry mismatch warnings when receiving. */
  batches?: { batchNo: string; expiry: string | null }[];
};

/**
 * Active products with pack sizes, barcodes and supplier prices, for the PO and GRN editors (searched in the browser).
 * shortcut: ships the whole active catalogue to the page; move to a search endpoint if catalogues pass ~5,000 products.
 */
export async function loadCatalog(t: Tx, o: { branchId: string; withBatches?: boolean }): Promise<CatalogItem[]> {
  const [prods, units, codes, prices, recent] = await Promise.all([
    t.select({ id: products.id, name: products.name, genericName: products.genericName, strength: products.strength, form: products.form, schedule: products.schedule, baseUnit: products.baseUnit })
      .from(products).where(eq(products.active, true)).orderBy(products.name),
    t.select({ id: productUnits.id, productId: productUnits.productId, name: productUnits.name, factor: productUnits.factor, isDefault: productUnits.isDefault }).from(productUnits).orderBy(productUnits.factor),
    t.select({ code: barcodes.code, productId: barcodes.productId, unitId: barcodes.unitId }).from(barcodes),
    t.select({ supplierId: supplierPrices.supplierId, productId: supplierPrices.productId, unitId: supplierPrices.unitId, costMinor: supplierPrices.costMinor }).from(supplierPrices),
    t.select({ productId: stockBatches.productId, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, cost: stockBatches.unitCostMinor })
      .from(stockBatches).where(and(eq(stockBatches.branchId, o.branchId), gte(stockBatches.receivedAt, new Date(Date.now() - 730 * 86400_000))))
      .orderBy(desc(stockBatches.receivedAt)),
  ]);
  const group = <T extends { productId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.productId, [...(m.get(r.productId) ?? []), r]);
    return m;
  };
  const u = group(units), c = group(codes), p = group(prices), b = group(recent);
  return prods.map((x) => ({
    ...x,
    units: (u.get(x.id) ?? []).map(({ id, name, factor, isDefault }) => ({ id, name, factor, isDefault })),
    codes: (c.get(x.id) ?? []).map(({ code, unitId }) => ({ code, unitId })),
    prices: (p.get(x.id) ?? []).map(({ supplierId, unitId, costMinor }) => ({ supplierId, unitId, costMinor })),
    lastCostPerBase: b.get(x.id)?.[0]?.cost ?? null,
    ...(o.withBatches ? { batches: (b.get(x.id) ?? []).map(({ batchNo, expiry }) => ({ batchNo, expiry })) } : {}),
  }));
}
