"use server";
import { and, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { customers, prescriptionItems, prescriptions, products } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { addDays, localDay } from "@/lib/format";
import { nextNumber } from "@/lib/numbers";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";

const opt = (max: number) => z.string().max(max).optional();
const item = z.object({
  drugName: z.string().trim().min(2).max(200), product: opt(300), dose: opt(100), frequency: opt(100), duration: opt(100),
  qty: z.coerce.number().int().nonnegative().max(100_000).default(0), directions: opt(500),
});
const rxForm = z.object({
  customer: z.string().trim().min(1, "Choose the customer"),
  prescriberName: z.string().trim().min(2, "Enter the prescriber's name").max(200), prescriberRegNo: opt(60), facility: opt(200),
  issuedOn: z.iso.date(), diagnosis: opt(2000), notes: opt(4000),
  refillsAllowed: z.coerce.number().int().min(0).max(24).default(0), refillIntervalDays: z.coerce.number().int().min(1).max(365).optional(),
});

async function guard() {
  const ctx = await requireWrite("prescriptions.write");
  if (!hasFeature(ctx.tenant, "prescriptions")) throw new UserError("Prescriptions need the Pro plan");
  return ctx;
}

/** Items come in as items.<n>.<field>. */
function parseItems(f: Record<string, string | undefined>) {
  const rows = new Map<string, Record<string, string | undefined>>();
  for (const [k, v] of Object.entries(f)) {
    const m = /^items\.(\d+)\.(\w+)$/.exec(k);
    if (m) rows.set(m[1], { ...rows.get(m[1]), [m[2]]: v });
  }
  return [...rows.values()].filter((r) => r.drugName).map((r) => item.parse(r));
}

export async function createPrescriptionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const f = formObject(fd);
    const o = rxForm.parse(f);
    const items = parseItems(f);
    if (!items.length) throw new UserError("Add at least one medicine");
    if (o.issuedOn > localDay(ctx.tenant.timezone)) throw new UserError("The issue date is in the future");
    const id = await tx(ctx, async (t) => {
      // "C-000012 · Name" from the picker, a customer number, or an id.
      const key = o.customer.split(" · ")[0].trim();
      const [c] = await t.select({ id: customers.id }).from(customers)
        .where(and(isNull(customers.deletedAt), /^[0-9a-f-]{36}$/.test(key) ? eq(customers.id, key) : eq(customers.customerNo, key.toUpperCase()))).limit(1);
      if (!c) throw new UserError("Customer not found. Pick them from the list, or add them first.");
      const matched = await Promise.all(items.map(async (i) => {
        if (!i.product) return null;
        const [p] = await t.select({ id: products.id }).from(products).where(and(eq(products.active, true), or(
          ilike(sql`${products.name} || coalesce(' ' || ${products.strength}, '')`, i.product), ilike(products.name, i.product)))).limit(1);
        return p?.id ?? null;
      }));
      const rxNo = await nextNumber(t, ctx.tenant.id, "rx");
      const [rx] = await t.insert(prescriptions).values({
        tenantId: ctx.tenant.id, branchId: ctx.branchId, rxNo, customerId: c.id, prescriberName: o.prescriberName, prescriberRegNo: o.prescriberRegNo ?? null,
        facility: o.facility ?? null, issuedOn: o.issuedOn, diagnosis: o.diagnosis ?? null, notes: o.notes ?? null,
        refillsAllowed: o.refillsAllowed, refillIntervalDays: o.refillIntervalDays ?? null, createdBy: ctx.user.id,
        verifiedBy: can(ctx.user.role, "sell.pharmacy") ? ctx.user.id : null,
      }).returning({ id: prescriptions.id });
      await t.insert(prescriptionItems).values(items.map((i, n) => ({
        tenantId: ctx.tenant.id, prescriptionId: rx.id, productId: matched[n], drugName: i.drugName, dose: i.dose ?? null, frequency: i.frequency ?? null,
        duration: i.duration ?? null, qtyPrescribed: i.qty, directions: i.directions ?? null,
      })));
      await audit(t, ctx, "create", "prescription", rx.id, { customerId: c.id, details: { rxNo, items: items.length } });
      return rx.id;
    });
    revalidatePath("/prescriptions");
    return { ok: true, id };
  });
}

export async function verifyPrescriptionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    if (!can(ctx.user.role, "sell.pharmacy")) throw new UserError("Only a pharmacist can verify a prescription");
    const { id } = z.object({ id: z.uuid() }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [r] = await t.update(prescriptions).set({ verifiedBy: ctx.user.id }).where(eq(prescriptions.id, id)).returning({ customerId: prescriptions.customerId });
      if (!r) throw new UserError("Prescription not found");
      await audit(t, ctx, "update", "prescription", id, { customerId: r.customerId, details: { verified: true } });
    });
    revalidatePath(`/prescriptions/${id}`);
  });
}

export async function setPrescriptionStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({ id: z.uuid(), status: z.enum(["active", "completed", "cancelled", "expired"]) }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [rx] = await t.select().from(prescriptions).where(eq(prescriptions.id, o.id)).for("update");
      if (!rx) throw new UserError("Prescription not found");
      const nextRefillDue = o.status !== "active" ? null : rx.nextRefillDue ?? (rx.refillIntervalDays && rx.refillsUsed ? addDays(localDay(ctx.tenant.timezone), rx.refillIntervalDays) : null);
      await t.update(prescriptions).set({ status: o.status, nextRefillDue }).where(eq(prescriptions.id, o.id));
      await audit(t, ctx, "update", "prescription", o.id, { customerId: rx.customerId, details: { status: o.status, was: rx.status } });
    });
    revalidatePath(`/prescriptions/${o.id}`);
    revalidatePath("/prescriptions");
  });
}
