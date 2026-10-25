"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { auditLog, purchaseOrderLines, supplierLinks } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { applySupplierConfirmation } from "@/lib/purchasing";
import { resolveSupplierLink } from "../session";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter prices like 25 or 25.50").transform((s) => Math.round(Number(s) * 100));

export async function confirmPoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const o = z.object({ token: z.string().max(100), note: z.string().max(1000).optional() }).parse(formObject(fd));
    const s = await resolveSupplierLink(o.token);
    if (!s || s === "blocked") throw new UserError("This link has expired. Ask the pharmacy to send the order again.");
    await withTenant(s.tenant.id, async (t) => {
      const lines = await t.select({ id: purchaseOrderLines.id }).from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, s.po.id));
      const parsed = lines.map((l) => ({
        lineId: l.id,
        supplierQty: z.coerce.number({ message: "Enter a quantity for every line (0 if you can't supply it)" }).int().min(0).max(1_000_000).parse(fd.get(`qty:${l.id}`)),
        supplierCostMinor: money.parse(String(fd.get(`cost:${l.id}`) ?? "").trim()),
      }));
      await applySupplierConfirmation(t, { tenantId: s.tenant.id, poId: s.po.id, note: o.note ?? null, lines: parsed });
      await t.update(supplierLinks).set({ lastUsedAt: new Date() }).where(eq(supplierLinks.id, s.link.id));
      await t.insert(auditLog).values({ tenantId: s.tenant.id, userId: null, action: "update", entity: "purchase_order", entityId: s.po.id, details: { via: "supplier_portal", supplierId: s.supplier.id, confirmed: true } });
    });
    revalidatePath(`/purchasing/${s.po.id}`);
    return { ok: true, message: "Thank you. The pharmacy can now see your confirmation." };
  });
}
