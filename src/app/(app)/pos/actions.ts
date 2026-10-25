"use server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { customers, heldSales, sales, users } from "@/db/schema";
import { run, UserError } from "@/lib/action";
import { audit, requireCtx, requireWrite, tx } from "@/lib/auth";
import { emit } from "@/lib/events";
import { e164, money } from "@/lib/format";
import { queueCustomerMessage } from "@/lib/messaging";
import { nextNumber } from "@/lib/numbers";
import { can } from "@/lib/permissions";
import type { CatCustomer } from "@/lib/pos-catalog";
import { receiptUrl } from "@/app/r/token";

// These are called directly by the till (not via forms), so each validates its own arguments.

const cartSchema = z.object({
  lines: z.array(z.object({ productId: z.uuid(), unitId: z.uuid(), qty: z.number().int().positive(), discountMinor: z.number().int().nonnegative(), priceMinor: z.number().int().nonnegative().optional(), rxItemId: z.uuid().nullish() })).max(200),
  customerId: z.uuid().nullish(), prescriptionId: z.uuid().nullish(), payerId: z.uuid().nullish(), memberNo: z.string().max(60).nullish(),
  saleDiscountMinor: z.number().int().nonnegative(), redeemPoints: z.number().int().nonnegative(),
});
export type HeldCart = z.infer<typeof cartSchema>;

export async function holdCartAction(label: string, cart: HeldCart) {
  return run(async () => {
    const ctx = await requireWrite("pos.sell");
    const c = cartSchema.parse(cart);
    if (!c.lines.length) throw new UserError("The cart is empty");
    const name = z.string().trim().min(1).max(60).parse(label || "Held sale");
    const id = await tx(ctx, async (t) => {
      const [h] = await t.insert(heldSales).values({ tenantId: ctx.tenant.id, branchId: ctx.branchId, label: name, cart: c, createdBy: ctx.user.id }).returning({ id: heldSales.id });
      return h.id;
    });
    return { ok: true, id };
  });
}

export async function listHeldAction() {
  const ctx = await requireCtx("pos.sell");
  return tx(ctx, (t) => t.select({ id: heldSales.id, label: heldSales.label, createdAt: heldSales.createdAt, by: users.name, cart: heldSales.cart })
    .from(heldSales).leftJoin(users, eq(users.id, heldSales.createdBy)).where(eq(heldSales.branchId, ctx.branchId)).orderBy(desc(heldSales.createdAt)).limit(50))
    .then((rows) => rows.map((r) => ({ id: r.id, label: r.label, at: r.createdAt.toISOString(), by: r.by, items: (r.cart as HeldCart).lines?.length ?? 0 })));
}

/** Resumes a held cart: returns it and removes it from the held list (so two tills can't both take it). */
export async function takeHeldAction(id: string): Promise<{ cart?: HeldCart; error?: string }> {
  const ctx = await requireWrite("pos.sell");
  const hid = z.uuid().parse(id);
  const row = await tx(ctx, async (t) => {
    const [h] = await t.delete(heldSales).where(and(eq(heldSales.id, hid), eq(heldSales.branchId, ctx.branchId))).returning();
    return h;
  });
  if (!row) return { error: "That held sale was already resumed or removed" };
  const parsed = cartSchema.safeParse(row.cart);
  return parsed.success ? { cart: parsed.data } : { error: "That held sale could not be read" };
}

export async function deleteHeldAction(id: string) {
  const ctx = await requireWrite("pos.sell");
  await tx(ctx, (t) => t.delete(heldSales).where(and(eq(heldSales.id, z.uuid().parse(id)), eq(heldSales.branchId, ctx.branchId))));
}

const quickCustomer = z.object({ name: z.string().trim().min(2, "Enter the customer's name").max(120), phone: z.string().trim().max(30).optional(), consent: z.boolean().default(false) });

/** Adds a customer from the till with just a name and phone. */
export async function quickAddCustomerAction(raw: z.input<typeof quickCustomer>): Promise<{ customer?: CatCustomer; error?: string }> {
  let out: CatCustomer | undefined;
  const r = await run(async () => {
    const ctx = await requireWrite("customers.write");
    const o = quickCustomer.parse(raw);
    const phone = e164(o.phone, ctx.tenant.country);
    const c = await tx(ctx, async (t) => {
      if (phone) {
        const [dup] = await t.select({ name: customers.name }).from(customers).where(eq(customers.phone, phone)).limit(1);
        if (dup) throw new UserError(`${dup.name} already has that phone number`);
      }
      const [c] = await t.insert(customers).values({
        tenantId: ctx.tenant.id, customerNo: await nextNumber(t, ctx.tenant.id, "customer"), name: o.name, phone,
        messagingConsent: o.consent, consentRecordedAt: o.consent ? new Date() : null, consentMethod: o.consent ? "verbal" : null,
      }).returning();
      await audit(t, ctx, "create", "customer", c.id, { customerId: c.id, details: { via: "till" } });
      await emit(t, ctx.tenant.id, "customer.created", { id: c.id, customerNo: c.customerNo });
      return c;
    });
    out = { id: c.id, name: c.name, customerNo: c.customerNo, phone: c.phone, balanceMinor: 0, creditLimitMinor: 0, points: 0, payerId: null, memberNo: null, consent: c.messagingConsent };
  });
  return out ? { customer: out } : { error: r?.error ?? "Could not add the customer" };
}

/** Allergies for the counter (encrypted at rest; the read is audited). */
export async function customerAlertsAction(id: string): Promise<{ allergies: string | null }> {
  const ctx = await requireCtx("customers.read");
  return tx(ctx, async (t) => {
    const [c] = await t.select({ id: customers.id, allergies: customers.allergies }).from(customers).where(eq(customers.id, z.uuid().parse(id)));
    if (!c) return { allergies: null };
    await audit(t, ctx, "view", "customer", c.id, { customerId: c.id, details: { field: "allergies", via: "till" } });
    return { allergies: c.allergies || null };
  });
}

/** WhatsApp/SMS receipt to the sale's customer, sent because they asked for it at the counter. */
export async function sendReceiptAction(saleId: string): Promise<{ ok?: boolean; error?: string }> {
  const r = await run(async () => {
    const ctx = await requireWrite("pos.sell");
    await tx(ctx, async (t) => {
      const [s] = await t.select().from(sales).where(eq(sales.id, z.uuid().parse(saleId)));
      if (!s) throw new UserError("Sale not found");
      if (!s.customerId) throw new UserError("Pick a customer to send the receipt to");
      const id = await queueCustomerMessage(t, {
        tenantId: ctx.tenant.id, customerId: s.customerId, templateKey: "receipt", purpose: "receipt",
        vars: { sale: s.saleNo, amount: money(s.totalMinor, ctx.tenant.currency), link: receiptUrl(s.id) }, dedupeKey: `receipt:${s.id}`,
      });
      if (!id) throw new UserError("The customer has opted out of messages or has no phone number");
      await audit(t, ctx, "send", "receipt", s.id, { customerId: s.customerId });
    });
  });
  return r?.error ? { error: r.error } : { ok: true };
}

/** Signed public link for a sale's receipt (wa.me sharing when no customer is attached). */
export async function receiptLinkAction(saleId: string) {
  const ctx = await requireCtx("pos.sell");
  if (!can(ctx.user.role, "pos.sell")) return null;
  const ok = await tx(ctx, async (t) => (await t.select({ id: sales.id }).from(sales).where(eq(sales.id, z.uuid().parse(saleId)))).length > 0);
  return ok ? receiptUrl(saleId) : null;
}
