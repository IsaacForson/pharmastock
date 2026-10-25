"use server";
import { outer } from "@/db";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { barcodes, productUnits, products } from "@/db/schema";
import { run, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { internalEan13 } from "@/lib/barcode";
import { emit } from "@/lib/events";
import { nextCounter } from "@/lib/numbers";

const ids = z.array(z.string().uuid()).min(1, "Choose at least one product").max(500);

/** Gives each chosen product that has no barcode an internal EAN-13 (20… range) on its default unit. */
export async function generateBarcodesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("products.write");
    const productIds = ids.parse(fd.getAll("productId").map(String));
    const made = await tx(ctx, async (t) => {
      const lacking = await t.select({ id: products.id, name: products.name }).from(products)
        .where(sql`${inArray(products.id, productIds)} and not exists (select 1 from ${barcodes} where ${barcodes.productId} = ${outer(products.id)})`);
      let n = 0;
      for (const p of lacking) {
        const [unit] = await t.select({ id: productUnits.id }).from(productUnits).where(eq(productUnits.productId, p.id))
          .orderBy(sql`${productUnits.isDefault} desc`, asc(productUnits.factor)).limit(1);
        if (!unit) continue;
        let code: string;
        // Skip numbers already used (e.g. an imported code that happens to sit in the 20… range).
        do code = internalEan13(await nextCounter(t, ctx.tenant.id, "internal_barcode"));
        while ((await t.select({ id: barcodes.id }).from(barcodes).where(eq(barcodes.code, code)).limit(1)).length);
        await t.insert(barcodes).values({ tenantId: ctx.tenant.id, code, productId: p.id, unitId: unit.id });
        await audit(t, ctx, "add_barcode", "product", p.id, { details: { code, generated: true } });
        await emit(t, ctx.tenant.id, "product.updated", { id: p.id, name: p.name, barcode: code });
        n++;
      }
      return n;
    });
    revalidatePath("/products/labels");
    return { ok: true, message: made ? `Made ${made} new barcode${made > 1 ? "s" : ""}.` : "Every chosen product already has a barcode." };
  });
}
