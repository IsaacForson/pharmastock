"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { integrations } from "@/db/schema";
import { formObject, run, UserError, zBool, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { e164 } from "@/lib/format";
import { sendNow } from "@/lib/messaging";
import { PROVIDERS } from "./providers";

export async function saveIntegrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const f = formObject(fd);
    const provider = z.string().refine((p) => p in PROVIDERS, "Unknown provider").parse(f.provider);
    const active = zBool.parse(f.active);
    await tx(ctx, async (t) => {
      const [existing] = await t.select().from(integrations).where(eq(integrations.provider, provider));
      const prev: Record<string, string> = existing ? JSON.parse(existing.config) : {};
      // Blank inputs keep the stored value, so masked secrets never need re-typing.
      const config = Object.fromEntries(PROVIDERS[provider].fields.map((fl) => [fl.key, f[fl.key] ?? prev[fl.key] ?? ""]));
      const missing = PROVIDERS[provider].fields.find((fl) => !fl.optional && !config[fl.key]);
      if (missing) throw new UserError(`${missing.label} is required`);
      await t.insert(integrations).values({ tenantId: ctx.tenant.id, provider, config: JSON.stringify(config), active })
        .onConflictDoUpdate({ target: [integrations.tenantId, integrations.provider], set: { config: JSON.stringify(config), active } });
      await audit(t, ctx, "update", "integration", provider, { details: { provider, active } });
    });
    revalidatePath("/settings/integrations");
    return { ok: true, message: "Saved." };
  });
}

export async function removeIntegrationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const provider = z.string().parse(fd.get("provider"));
    await tx(ctx, async (t) => {
      await t.delete(integrations).where(and(eq(integrations.tenantId, ctx.tenant.id), eq(integrations.provider, provider)));
      await audit(t, ctx, "delete", "integration", provider, { details: { provider } });
    });
    revalidatePath("/settings/integrations");
  });
}

export async function testSendAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const o = z.object({ channel: z.enum(["whatsapp", "sms"]), to: z.string().min(6, "Enter a phone number") }).parse(formObject(fd));
    const to = e164(o.to, ctx.tenant.country)!;
    try {
      const r = await sendNow({ tenantId: ctx.tenant.id, channel: o.channel, to, body: `Test message from ${ctx.tenant.name} via PharmaStock. Your messaging is working.` });
      await tx(ctx, (t) => audit(t, ctx, "send", "integration_test", null, { details: { channel: r.channel, provider: r.provider } }));
      return { ok: true, message: `Sent by ${r.channel === "sms" ? "SMS" : "WhatsApp"} via ${r.provider}${r.channel !== o.channel ? " (WhatsApp unavailable, fell back to SMS)" : ""}.` };
    } catch (e) {
      throw new UserError(`Send failed: ${(e as Error).message}`);
    }
  });
}
