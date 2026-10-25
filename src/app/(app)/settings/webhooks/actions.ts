"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { formObject, run, UserError, zBool, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { WEBHOOK_EVENTS } from "@/lib/events";
import { enqueue } from "@/lib/jobs";

const zUrl = z.string().url("Enter a full URL").refine((u) => u.startsWith("https://") || (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)/.test(u)), "Webhook URLs must use https://");

function eventsFrom(fd: FormData) {
  const events = [...new Set(fd.getAll("events").map(String))].filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) throw new UserError("Choose at least one event");
  return events;
}

export async function createWebhookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("api.manage");
    const url = zUrl.parse(formObject(fd).url);
    const events = eventsFrom(fd);
    const secret = `whsec_${randomToken(24)}`;
    await tx(ctx, async (t) => {
      const [w] = await t.insert(webhooks).values({ tenantId: ctx.tenant.id, url, secret, events }).returning({ id: webhooks.id });
      await audit(t, ctx, "create", "webhook", w.id, { details: { url, events } });
    });
    revalidatePath("/settings/webhooks");
    return { ok: true, message: `Webhook added. Signing secret (copy it now — shown only once): ${secret}` };
  });
}

export async function updateWebhookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("api.manage");
    const f = formObject(fd);
    const id = z.string().uuid().parse(f.id);
    const url = zUrl.parse(f.url);
    const events = eventsFrom(fd);
    const active = zBool.parse(f.active);
    await tx(ctx, async (t) => {
      await t.update(webhooks).set({ url, events, active }).where(eq(webhooks.id, id));
      await audit(t, ctx, "update", "webhook", id, { details: { url, events, active } });
    });
    revalidatePath("/settings/webhooks");
    return { ok: true, message: "Saved." };
  });
}

export async function deleteWebhookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("api.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    await tx(ctx, async (t) => {
      await t.delete(webhooks).where(eq(webhooks.id, id));
      await audit(t, ctx, "delete", "webhook", id);
    });
    revalidatePath("/settings/webhooks");
  });
}

export async function testWebhookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("api.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    await tx(ctx, async (t) => {
      const [w] = await t.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.id, id));
      if (!w) throw new UserError("Webhook not found");
      const [d] = await t.insert(webhookDeliveries).values({
        tenantId: ctx.tenant.id, webhookId: id, event: "ping", payload: { event: "ping", data: { message: "Test from PharmaStock" }, createdAt: new Date().toISOString() },
      }).returning({ id: webhookDeliveries.id });
      await enqueue(t, ctx.tenant.id, "webhook.deliver", { deliveryId: d.id });
    });
    revalidatePath("/settings/webhooks");
  });
}
