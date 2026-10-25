"use server";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { customers, payers } from "@/db/schema";
import { formObject, run, UserError, zBool, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { emit } from "@/lib/events";
import { e164, money } from "@/lib/format";
import { queueCustomerMessage } from "@/lib/messaging";
import { nextNumber } from "@/lib/numbers";
import { can } from "@/lib/permissions";
import { recordRepayment } from "@/lib/sales";

const opt = (max: number) => z.string().max(max).optional();
const customerForm = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter the customer's name").max(120),
  phone: opt(30), email: z.email("Enter a valid email").max(200).optional(), dob: z.iso.date().optional(), sex: z.enum(["female", "male", "other"]).optional(),
  address: opt(500), allergies: opt(2000), notes: opt(4000),
  creditLimit: zMoney.optional(), payerId: z.uuid().optional(), memberNo: opt(60),
  consent: zBool, consentMethod: z.enum(["verbal", "whatsapp", "form"]).optional(), optedOut: zBool,
  preferredChannel: z.enum(["whatsapp", "sms", "email"]).default("whatsapp"),
});

export async function saveCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("customers.write");
    const o = customerForm.parse(formObject(fd));
    const phone = e164(o.phone, ctx.tenant.country);
    const id = await tx(ctx, async (t) => {
      if (phone) {
        const [dup] = await t.select({ name: customers.name }).from(customers).where(and(eq(customers.phone, phone), o.id ? ne(customers.id, o.id) : undefined)).limit(1);
        if (dup) throw new UserError(`${dup.name} already has that phone number`);
      }
      if (o.payerId && !(await t.select({ id: payers.id }).from(payers).where(eq(payers.id, o.payerId))).length) throw new UserError("Insurer not found");
      const [prev] = o.id ? await t.select().from(customers).where(eq(customers.id, o.id)).for("update") : [];
      if (o.id && !prev) throw new UserError("Customer not found");
      const now = new Date();
      // Credit limits are a manager decision; others keep the current limit.
      const creditLimitMinor = can(ctx.user.role, "settings.manage") ? (o.creditLimit ?? 0) : (prev?.creditLimitMinor ?? 0);
      const values = {
        name: o.name, phone, email: o.email ?? null, dob: o.dob ?? null, sex: o.sex ?? null, address: o.address ?? null,
        allergies: o.allergies ?? null, notes: o.notes ?? null, creditLimitMinor, payerId: o.payerId ?? null, memberNo: o.memberNo ?? null,
        messagingConsent: o.consent, consentRecordedAt: o.consent ? (prev?.messagingConsent ? prev.consentRecordedAt : now) : null,
        consentMethod: o.consent ? (o.consentMethod ?? prev?.consentMethod ?? "verbal") : null,
        optedOutAt: o.optedOut ? (prev?.optedOutAt ?? now) : null, preferredChannel: o.preferredChannel,
      };
      if (prev) {
        await t.update(customers).set(values).where(eq(customers.id, prev.id));
        const changed = Object.keys(values).filter((k) => !["allergies", "notes"].includes(k) && String(values[k as keyof typeof values] ?? "") !== String(prev[k as keyof typeof prev] ?? ""));
        await audit(t, ctx, "update", "customer", prev.id, { customerId: prev.id, details: { changed } });
        return prev.id;
      }
      const [c] = await t.insert(customers).values({ tenantId: ctx.tenant.id, customerNo: await nextNumber(t, ctx.tenant.id, "customer"), ...values }).returning({ id: customers.id, no: customers.customerNo });
      await audit(t, ctx, "create", "customer", c.id, { customerId: c.id });
      await emit(t, ctx.tenant.id, "customer.created", { id: c.id, customerNo: c.no });
      return c.id;
    });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { ok: true, id };
  });
}

export async function repaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("pos.sell");
    const o = z.object({ customerId: z.uuid(), amount: zMoney, method: z.enum(["cash", "mobile_money", "card", "bank"]), reference: opt(120), clientId: z.string().min(8).max(100) }).parse(formObject(fd));
    const p = await tx(ctx, (t) => recordRepayment(t, ctx, { customerId: o.customerId, amountMinor: o.amount, method: o.method, reference: o.reference ?? null, clientId: o.clientId }));
    revalidatePath(`/customers/${o.customerId}`);
    return { ok: true, message: `Payment of ${money(p.amountMinor, ctx.tenant.currency)} recorded (${p.receiptNo}).` };
  });
}

export async function balanceReminderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("customers.write");
    const { customerId } = z.object({ customerId: z.uuid() }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [c] = await t.select().from(customers).where(eq(customers.id, customerId));
      if (!c) throw new UserError("Customer not found");
      if (c.balanceMinor <= 0) throw new UserError(`${c.name} doesn't owe anything`);
      const id = await queueCustomerMessage(t, {
        tenantId: ctx.tenant.id, customerId: c.id, templateKey: "balance_due", purpose: "balance",
        vars: { amount: money(c.balanceMinor, ctx.tenant.currency) },
      });
      if (!id) throw new UserError(c.optedOutAt ? `${c.name} has opted out of messages` : !c.messagingConsent ? `${c.name} hasn't agreed to receive messages. Record their consent first.` : "No phone number or email on file");
      await audit(t, ctx, "send", "customer", c.id, { customerId: c.id, details: { template: "balance_due" } });
    });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, message: "Reminder queued." };
  });
}
