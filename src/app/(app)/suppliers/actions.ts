"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { suppliers, supplierPrices } from "@/db/schema";
import { formObject, run, UserError, zBool, zInt, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { e164, localDay } from "@/lib/format";
import { recordSupplierPayment, upsertSupplierPrice } from "@/lib/purchasing";

const days = (max: number) => zInt.pipe(z.number().min(0).max(max));
const supplierSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2, "Supplier name is required").max(200),
  contactName: z.string().max(200).optional(), phone: z.string().max(40).optional(), email: z.string().email("Enter a valid email").optional(),
  address: z.string().max(500).optional(), licenceNo: z.string().max(100).optional(),
  paymentTermsDays: days(365).default(0), leadTimeDays: days(180).default(3),
  returnMinDaysToExpiry: days(1095).default(90), returnWithinDaysOfDelivery: days(1095).default(0),
  active: zBool,
});

export async function saveSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("suppliers.manage");
    const o = supplierSchema.parse({ active: "on", ...formObject(fd) });
    const phone = e164(o.phone, ctx.tenant.country);
    if (phone && !/^\+\d{8,15}$/.test(phone)) throw new UserError("Enter the WhatsApp number with its country code, e.g. +233 24 123 4567");
    const row = {
      name: o.name, contactName: o.contactName ?? null, phone, email: o.email?.toLowerCase() ?? null, address: o.address ?? null, licenceNo: o.licenceNo ?? null,
      paymentTermsDays: o.paymentTermsDays, leadTimeDays: o.leadTimeDays, returnMinDaysToExpiry: o.returnMinDaysToExpiry, returnWithinDaysOfDelivery: o.returnWithinDaysOfDelivery,
      active: o.id ? o.active : true,
    };
    const id = await tx(ctx, async (t) => {
      if (o.id) {
        const [u] = await t.update(suppliers).set(row).where(eq(suppliers.id, o.id)).returning({ id: suppliers.id });
        if (!u) throw new UserError("Supplier not found");
        await audit(t, ctx, "update", "supplier", o.id);
        return o.id;
      }
      const [s] = await t.insert(suppliers).values({ tenantId: ctx.tenant.id, ...row }).returning({ id: suppliers.id });
      await audit(t, ctx, "create", "supplier", s.id);
      return s.id;
    });
    revalidatePath("/suppliers");
    return { ok: true, id };
  });
}

const paymentSchema = z.object({
  supplierId: z.string().uuid(), receiptId: z.string().uuid().optional(), amount: zMoney,
  method: z.enum(["cash", "mobile_money", "card", "bank"]), reference: z.string().max(100).optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the payment date"),
});

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("supplier.payments");
    const o = paymentSchema.parse(formObject(fd));
    if (o.paidAt > localDay(ctx.tenant.timezone)) throw new UserError("Payment date can't be in the future");
    await tx(ctx, (t) => recordSupplierPayment(t, ctx, { supplierId: o.supplierId, receiptId: o.receiptId, amountMinor: o.amount, method: o.method, reference: o.reference, paidAt: o.paidAt }));
    revalidatePath(`/suppliers/${o.supplierId}`);
    revalidatePath("/suppliers/payments");
    return { ok: true, message: "Payment recorded." };
  });
}

const priceSchema = z.object({ supplierId: z.string().uuid(), productId: z.string().uuid("Choose a product"), unitId: z.string().uuid("Choose a pack"), cost: zMoney, supplierCode: z.string().max(60).optional() });

export async function savePriceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("purchasing.manage");
    const o = priceSchema.parse(formObject(fd));
    await tx(ctx, async (t) => {
      await upsertSupplierPrice(t, ctx.tenant.id, { supplierId: o.supplierId, productId: o.productId, unitId: o.unitId, costMinor: o.cost, source: "manual", supplierCode: o.supplierCode ?? null });
      await audit(t, ctx, "price", "supplier_price", o.supplierId, { details: { productId: o.productId, unitId: o.unitId, costMinor: o.cost } });
    });
    revalidatePath(`/suppliers/${o.supplierId}`);
    return { ok: true, message: "Price saved." };
  });
}

export async function deletePriceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("purchasing.manage");
    const o = z.object({ supplierId: z.string().uuid(), productId: z.string().uuid(), unitId: z.string().uuid() }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      await t.delete(supplierPrices).where(and(eq(supplierPrices.supplierId, o.supplierId), eq(supplierPrices.productId, o.productId), eq(supplierPrices.unitId, o.unitId)));
      await audit(t, ctx, "delete", "supplier_price", o.supplierId, { details: o });
    });
    revalidatePath(`/suppliers/${o.supplierId}`);
  });
}
