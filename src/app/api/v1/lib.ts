import { and, asc, gt, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Tx } from "@/db";
import { barcodes, productUnits, products } from "@/db/schema";
import { ApiError } from "@/lib/api-auth";

/** where-clause for cursor pagination (rows ordered by id, cursor = last id seen). */
export const after = (idCol: PgColumn, cursor: string | null, ...rest: (SQL | undefined)[]) => and(cursor ? gt(idCol, cursor) : undefined, ...rest);

export const uuidParam = (v: string | null, name: string) => {
  if (v === null || v === "") return undefined;
  if (!z.uuid().safeParse(v).success) throw new ApiError(400, `${name} must be a UUID`);
  return v;
};
export const dateParam = (v: string | null, name: string) => {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(v) || Number.isNaN(Date.parse(v))) throw new ApiError(400, `${name} must be an ISO date or date-time`);
  return new Date(v).toISOString();
};
export const notFound = () => { throw new ApiError(404, "Not found"); };

/** Product with its pack sizes and barcodes, as the API returns it. */
export async function withUnits<T extends { id: string }>(t: Tx, rows: T[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const units = await t.select().from(productUnits).where(inArray(productUnits.productId, ids)).orderBy(asc(productUnits.factor));
  const codes = await t.select().from(barcodes).where(inArray(barcodes.productId, ids));
  return rows.map((r) => ({
    ...r,
    units: units.filter((u) => u.productId === r.id).map(({ id, name, factor, sellPriceMinor, sellable, isDefault }) => ({ id, name, factor, sellPriceMinor, sellable, isDefault, barcodes: codes.filter((c) => c.unitId === id).map((c) => c.code) })),
  }));
}

export const productFields = {
  id: products.id, name: products.name, genericName: products.genericName, strength: products.strength, form: products.form, manufacturer: products.manufacturer,
  categoryId: products.categoryId, schedule: products.schedule, baseUnit: products.baseUnit, taxBp: products.taxBp, reorderLevel: products.reorderLevel, reorderQty: products.reorderQty,
  preferredSupplierId: products.preferredSupplierId, shelf: products.shelf, active: products.active, createdAt: products.createdAt, updatedAt: products.updatedAt,
};

export const productInput = z.object({
  name: z.string().trim().min(1).max(200), genericName: z.string().trim().max(200).nullish(), strength: z.string().trim().max(60).nullish(), form: z.string().trim().max(60).nullish(),
  manufacturer: z.string().trim().max(200).nullish(), schedule: z.enum(["otc", "pharmacy", "pom", "controlled", "non_drug"]).default("otc"), baseUnit: z.string().trim().min(1).max(40).default("unit"),
  taxBp: z.number().int().min(0).max(10_000).nullish(), reorderLevel: z.number().int().min(0).max(10_000_000).default(0), reorderQty: z.number().int().min(0).max(10_000_000).default(0),
  shelf: z.string().trim().max(40).nullish(),
  units: z.array(z.object({ name: z.string().trim().min(1).max(60), factor: z.number().int().min(1).max(100_000), sellPriceMinor: z.number().int().min(0).max(1_000_000_000), isDefault: z.boolean().default(false), barcodes: z.array(z.string().trim().min(3).max(64)).max(10).default([]) }))
    .min(1).max(10).default([{ name: "unit", factor: 1, sellPriceMinor: 0, isDefault: true, barcodes: [] }]),
}).strict();

