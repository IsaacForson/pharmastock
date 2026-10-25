"use server";
import { and, eq, inArray, ne, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { barcodes, categories, productUnits, products, suppliers } from "@/db/schema";
import { formObject, run, UserError, zBool, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { setUnitPrice } from "@/lib/catalog";
import { emit } from "@/lib/events";
import { can } from "@/lib/permissions";

const unitSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Every pack needs a name").max(40),
  factor: z.coerce.number().int().min(1, "Pack size must be 1 or more").max(100_000),
  price: z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, "Enter prices like 25 or 25.50").transform((s) => Math.round(Number(s || 0) * 100)),
  sellable: z.boolean(),
  isDefault: z.boolean(),
  barcodes: z.array(z.string().trim().min(3, "Barcodes need at least 3 characters").max(64)).max(20),
});

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Enter the product name").max(120),
  genericName: z.string().max(120).optional(), strength: z.string().max(40).optional(), form: z.string().max(40).optional(),
  manufacturer: z.string().max(120).optional(),
  categoryId: z.string().uuid().optional(), newCategory: z.string().max(60).optional(),
  schedule: z.enum(["otc", "pharmacy", "pom", "controlled", "non_drug"]),
  baseUnit: z.string().min(1).max(30).default("unit"),
  taxPercent: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/, "Tax rate like 0, 12.5 or 15").optional(),
  reorderLevel: z.coerce.number().int().min(0).default(0), reorderQty: z.coerce.number().int().min(0).default(0),
  preferredSupplierId: z.string().uuid().optional(), shelf: z.string().max(20).optional(),
  favorite: zBool, active: zBool,
  units: z.string().transform((s, c) => { try { return JSON.parse(s) as unknown; } catch { c.addIssue({ code: "custom", message: "Pack sizes are missing" }); return z.NEVER; } })
    .pipe(z.array(unitSchema).min(1, "Add at least one pack size").max(10)),
});

export async function saveProductAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("products.write");
    const o = productSchema.parse(formObject(fd));
    if (o.units.filter((u) => u.isDefault).length !== 1) throw new UserError("Choose one pack size as the default for scanning and search");
    if (new Set(o.units.map((u) => u.name.toLowerCase())).size !== o.units.length) throw new UserError("Pack names must be different");
    const codes = o.units.flatMap((u) => u.barcodes);
    if (new Set(codes).size !== codes.length) throw new UserError("The same barcode is on two pack sizes");

    const id = await tx(ctx, async (t) => {
      let categoryId = o.categoryId ?? null;
      if (o.newCategory) {
        const [c] = await t.insert(categories).values({ tenantId: ctx.tenant.id, name: o.newCategory }).onConflictDoUpdate({ target: [categories.tenantId, categories.name], set: { name: o.newCategory } }).returning({ id: categories.id });
        categoryId = c.id;
      }
      if (o.preferredSupplierId && !(await t.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, o.preferredSupplierId))).length) throw new UserError("Supplier not found");
      const values = {
        name: o.name, genericName: o.genericName ?? null, strength: o.strength ?? null, form: o.form ?? null, manufacturer: o.manufacturer ?? null,
        categoryId, schedule: o.schedule, baseUnit: o.baseUnit, taxBp: o.taxPercent === undefined ? null : Math.round(Number(o.taxPercent) * 100),
        reorderLevel: o.reorderLevel, reorderQty: o.reorderQty, preferredSupplierId: o.preferredSupplierId ?? null, shelf: o.shelf ?? null,
        favorite: o.favorite, active: o.id ? o.active : true, updatedAt: new Date(),
      };
      let productId: string;
      if (o.id) {
        const [p] = await t.update(products).set(values).where(eq(products.id, o.id)).returning({ id: products.id });
        if (!p) throw new UserError("Product not found");
        productId = p.id;
      } else {
        productId = (await t.insert(products).values({ ...values, tenantId: ctx.tenant.id }).returning({ id: products.id }))[0].id;
      }

      if (codes.length) {
        const taken = await t.select({ code: barcodes.code, name: products.name }).from(barcodes).innerJoin(products, eq(products.id, barcodes.productId))
          .where(and(inArray(barcodes.code, codes), ne(barcodes.productId, productId)));
        if (taken.length) throw new UserError(`Barcode ${taken[0].code} is already on ${taken[0].name}`);
      }

      const existing = await t.select().from(productUnits).where(eq(productUnits.productId, productId));
      const priceChanged: string[] = [];
      for (const u of o.units) {
        const old = u.id ? existing.find((e) => e.id === u.id) : undefined;
        if (u.id && !old) throw new UserError("A pack size was removed by someone else. Reload and try again.");
        let unitId: string;
        if (old) {
          await t.update(productUnits).set({ name: u.name, factor: u.factor, sellable: u.sellable, isDefault: u.isDefault }).where(eq(productUnits.id, old.id));
          if (old.sellPriceMinor !== u.price) {
            if (!can(ctx.user.role, "prices.write")) throw new UserError("You can't change selling prices. Ask a manager.");
            await setUnitPrice(t, ctx, old, u.price);
            priceChanged.push(u.name);
          }
          unitId = old.id;
        } else {
          if (o.id && !can(ctx.user.role, "prices.write") && u.price) throw new UserError("You can't set selling prices. Ask a manager.");
          unitId = (await t.insert(productUnits).values({ tenantId: ctx.tenant.id, productId, name: u.name, factor: u.factor, sellPriceMinor: u.price, sellable: u.sellable, isDefault: u.isDefault }).returning({ id: productUnits.id }))[0].id;
        }
        await t.delete(barcodes).where(and(eq(barcodes.unitId, unitId), u.barcodes.length ? notInArray(barcodes.code, u.barcodes) : undefined));
        for (const code of u.barcodes) await t.insert(barcodes).values({ tenantId: ctx.tenant.id, code, productId, unitId }).onConflictDoUpdate({ target: [barcodes.tenantId, barcodes.code], set: { unitId } });
      }
      // Removed packs: delete when nothing refers to them, otherwise just stop selling them.
      for (const gone of existing.filter((e) => !o.units.some((u) => u.id === e.id))) {
        try { await t.transaction((sp) => sp.delete(productUnits).where(eq(productUnits.id, gone.id))); }
        catch { await t.update(productUnits).set({ sellable: false, isDefault: false }).where(eq(productUnits.id, gone.id)); }
      }

      await audit(t, ctx, o.id ? "update" : "create", "product", productId, { details: { name: o.name, priceChanged: priceChanged.length ? priceChanged : undefined } });
      await emit(t, ctx.tenant.id, o.id ? "product.updated" : "product.created", { id: productId, name: o.name, schedule: o.schedule, active: values.active });
      return productId;
    });
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    return { ok: true, id };
  });
}
