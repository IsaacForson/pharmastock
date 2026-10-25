import { asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { barcodes, productUnits, products } from "@/db/schema";
import { apiAudit, apiHandler, assertWritable, page, pageParams, readJson } from "@/lib/api-auth";
import { emit } from "@/lib/events";
import { after, productFields, productInput, withUnits } from "../lib";

export function GET(req: Request) {
  return apiHandler(req, "products:read", async (t) => {
    const { limit, cursor, params } = pageParams(req);
    const qs = params.get("q");
    const like = qs ? `%${qs.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await t.select(productFields).from(products)
      .where(after(products.id, cursor, like ? or(ilike(products.name, like), ilike(products.genericName, like)) : undefined, params.get("active") === "false" ? eq(products.active, false) : params.get("active") === "all" ? undefined : eq(products.active, true)))
      .orderBy(asc(products.id)).limit(limit + 1);
    const p = page(rows, limit);
    return { ...p, data: await withUnits(t, p.data) };
  });
}

export function POST(req: Request) {
  return apiHandler(req, "products:write", async (t, k) => {
    await assertWritable(t, k);
    const input = productInput.parse(await readJson(req));
    const { units, ...fields } = input;
    const [p] = await t.insert(products).values({ ...fields, tenantId: k.tenantId }).returning({ id: products.id });
    const hasDefault = units.some((u) => u.isDefault);
    for (const [i, u] of units.entries()) {
      const [unit] = await t.insert(productUnits).values({ tenantId: k.tenantId, productId: p.id, name: u.name, factor: u.factor, sellPriceMinor: u.sellPriceMinor, isDefault: u.isDefault || (!hasDefault && i === 0) }).returning({ id: productUnits.id });
      for (const code of u.barcodes) {
        const [b] = await t.insert(barcodes).values({ tenantId: k.tenantId, productId: p.id, unitId: unit.id, code }).onConflictDoNothing().returning({ id: barcodes.id });
        if (!b) throw new z.ZodError([{ code: "custom", path: ["units", i, "barcodes"], message: `Barcode ${code} is already used by another product`, input: code }]);
      }
    }
    await apiAudit(t, k, "create", "product", p.id, null, { name: input.name });
    await emit(t, k.tenantId, "product.created", { id: p.id, name: input.name });
    const [row] = await withUnits(t, await t.select(productFields).from(products).where(eq(products.id, p.id)));
    return Response.json(row, { status: 201 });
  });
}
