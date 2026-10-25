import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { priceChanges, productUnits, products } from "@/db/schema";
import { apiAudit, apiHandler, assertWritable, readJson } from "@/lib/api-auth";
import { emit } from "@/lib/events";
import { notFound, productFields, productInput, uuidParam, withUnits } from "../../lib";

export async function GET(req: Request, { params }: RouteContext<"/api/v1/products/[id]">) {
  const id = uuidParam((await params).id, "id")!;
  return apiHandler(req, "products:read", async (t) => (await withUnits(t, await t.select(productFields).from(products).where(eq(products.id, id))))[0] ?? notFound());
}

const patch = productInput.omit({ units: true }).partial().extend({
  active: z.boolean().optional(),
  prices: z.array(z.object({ unitId: z.uuid(), sellPriceMinor: z.number().int().min(0).max(1_000_000_000) })).max(10).optional(),
}).strict();

/** Partial update. Price changes go through `prices` so they are logged in price history (price-change impact report). */
export async function PATCH(req: Request, { params }: RouteContext<"/api/v1/products/[id]">) {
  const id = uuidParam((await params).id, "id")!;
  return apiHandler(req, "products:write", async (t, k) => {
    await assertWritable(t, k);
    const { prices, ...fields } = patch.parse(await readJson(req));
    const [exists] = await t.select({ id: products.id }).from(products).where(eq(products.id, id));
    if (!exists) notFound();
    if (Object.keys(fields).length) await t.update(products).set({ ...fields, updatedAt: new Date() }).where(eq(products.id, id));
    for (const p of prices ?? []) {
      const [u] = await t.select().from(productUnits).where(and(eq(productUnits.id, p.unitId), eq(productUnits.productId, id)));
      if (!u) throw new z.ZodError([{ code: "custom", path: ["prices"], message: "unitId does not belong to this product", input: p.unitId }]);
      if (u.sellPriceMinor === p.sellPriceMinor) continue;
      await t.update(productUnits).set({ sellPriceMinor: p.sellPriceMinor }).where(eq(productUnits.id, u.id));
      await t.insert(priceChanges).values({ tenantId: k.tenantId, productId: id, unitId: u.id, oldPriceMinor: u.sellPriceMinor, newPriceMinor: p.sellPriceMinor, changedBy: k.createdBy });
      await apiAudit(t, k, "price", "product", id, null, { unitId: u.id, from: u.sellPriceMinor, to: p.sellPriceMinor });
    }
    await apiAudit(t, k, "update", "product", id, null, { fields: Object.keys(fields) });
    await emit(t, k.tenantId, "product.updated", { id, fields: Object.keys(fields), prices: prices ?? [] });
    return (await withUnits(t, await t.select(productFields).from(products).where(eq(products.id, id))))[0];
  });
}
