"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { deliveries, sales } from "@/db/schema";
import { formObject, run, UserError, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { e164 } from "@/lib/format";
import { queueCustomerMessage } from "@/lib/messaging";
import { hasFeature } from "@/lib/plans";

async function guard() {
  const ctx = await requireWrite("deliveries.manage");
  if (!hasFeature(ctx.tenant, "delivery")) throw new UserError("Deliveries need the Pro plan");
  return ctx;
}

export async function createDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({
      saleId: z.uuid(), address: z.string().trim().min(5, "Enter the delivery address").max(500), phone: z.string().max(30).optional(),
      rider: z.string().max(120).optional(), fee: zMoney.optional(), notes: z.string().max(500).optional(),
    }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [s] = await t.select().from(sales).where(eq(sales.id, o.saleId));
      if (!s) throw new UserError("Sale not found");
      if (s.status === "voided") throw new UserError("That sale was voided");
      if ((await t.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.saleId, s.id))).length) throw new UserError("That sale already has a delivery");
      const [d] = await t.insert(deliveries).values({
        tenantId: ctx.tenant.id, branchId: s.branchId, saleId: s.id, customerId: s.customerId, address: o.address, phone: e164(o.phone, ctx.tenant.country),
        rider: o.rider ?? null, feeMinor: o.fee ?? ctx.tenant.deliveryFeeMinor, notes: o.notes ?? null, createdBy: ctx.user.id,
      }).returning({ id: deliveries.id });
      await audit(t, ctx, "create", "delivery", d.id, { customerId: s.customerId, details: { sale: s.saleNo } });
    });
    revalidatePath("/deliveries");
    return { ok: true };
  });
}

const STATUS = ["pending", "out", "delivered", "failed", "cancelled"] as const;

export async function deliveryStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const o = z.object({ id: z.uuid(), status: z.enum(STATUS), rider: z.string().max(120).optional() }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [d] = await t.select().from(deliveries).where(eq(deliveries.id, o.id)).for("update");
      if (!d) throw new UserError("Delivery not found");
      if (d.status === "delivered" || d.status === "cancelled") throw new UserError(`This delivery is already ${d.status}`);
      const now = new Date();
      await t.update(deliveries).set({
        status: o.status, rider: o.rider ?? d.rider,
        dispatchedAt: o.status === "out" ? now : d.dispatchedAt, deliveredAt: o.status === "delivered" ? now : d.deliveredAt,
      }).where(eq(deliveries.id, d.id));
      await audit(t, ctx, "update", "delivery", d.id, { customerId: d.customerId, details: { from: d.status, to: o.status } });
    });
    revalidatePath("/deliveries");
  });
}

const WORDS: Record<string, string> = { pending: "being prepared", out: "on its way", delivered: "delivered", failed: "delayed: we'll call you", cancelled: "cancelled" };

/** Order update to the customer (they asked for delivery, so no marketing consent is needed; opt-out still wins). */
export async function notifyDeliveryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await guard();
    const { id } = z.object({ id: z.uuid() }).parse(formObject(fd));
    await tx(ctx, async (t) => {
      const [row] = await t.select({ d: deliveries, saleNo: sales.saleNo }).from(deliveries).leftJoin(sales, eq(sales.id, deliveries.saleId)).where(eq(deliveries.id, id));
      if (!row) throw new UserError("Delivery not found");
      if (!row.d.customerId) throw new UserError("This sale has no customer to message");
      const sent = await queueCustomerMessage(t, {
        tenantId: ctx.tenant.id, customerId: row.d.customerId, templateKey: "order_ready", purpose: "order_update",
        vars: { sale: row.saleNo ?? "", status: WORDS[row.d.status] ?? row.d.status }, dedupeKey: `delivery:${id}:${row.d.status}`,
      });
      if (!sent) throw new UserError("Not sent: the customer opted out, has no phone, or was already told about this status");
      await audit(t, ctx, "send", "delivery", id, { customerId: row.d.customerId, details: { status: row.d.status } });
    });
    return { ok: true, message: "Message queued." };
  });
}
