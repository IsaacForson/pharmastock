import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { adminDb, withTenant, type Tx } from "@/db";
import { alerts, auditLog, branches, customers, messageLog, prescriptionItems, prescriptions, sales, tenants } from "@/db/schema";
import { emit } from "@/lib/events";
import { localDay } from "@/lib/format";
import { sendNow, type Channel } from "@/lib/messaging";

export type Command = { kind: "refill" } | { kind: "stop" } | { kind: "start" } | { kind: "unknown" };

/** Parses a customer's reply. Anything unrecognised is left for the pharmacy's inbox. */
export function parseCommand(raw: string): Command {
  const s = raw.trim().toUpperCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (["1", "YES", "Y", "REFILL", "YES PLEASE", "OK"].includes(s)) return { kind: "refill" };
  if (["STOP", "UNSUBSCRIBE", "STOP ALL", "OPT OUT", "OPTOUT"].includes(s)) return { kind: "stop" };
  if (["START", "SUBSCRIBE", "UNSTOP"].includes(s)) return { kind: "start" };
  return { kind: "unknown" };
}

const PURPOSE: Record<Command["kind"], string> = { refill: "refill", stop: "consent", start: "consent", unknown: "inbound" };
const REFILL_REPLY_DAYS = 14;

/** Normalises a provider sender id to E.164 (WhatsApp sends digits without "+"). */
export const senderE164 = (from: string) => "+" + from.replace(/\D/g, "").replace(/^00/, "");

/** Finds the customer by phone across pharmacies; with several, the pharmacy that messaged this number most recently wins. */
export async function identifySender(phone: string) {
  const db = adminDb();
  const matches = await db.select({ id: customers.id, tenantId: customers.tenantId }).from(customers)
    .where(and(eq(customers.phone, phone), isNull(customers.deletedAt))).orderBy(desc(customers.createdAt)).limit(50);
  if (!matches.length) return null;
  const [last] = await db.select({ tenantId: messageLog.tenantId, customerId: messageLog.customerId }).from(messageLog)
    .where(and(eq(messageLog.to, phone), eq(messageLog.direction, "out"), inArray(messageLog.tenantId, [...new Set(matches.map((m) => m.tenantId))])))
    .orderBy(desc(messageLog.createdAt)).limit(1);
  if (!last) return matches[0];
  return matches.find((m) => m.id === last.customerId) ?? matches.find((m) => m.tenantId === last.tenantId)!;
}

async function reply(t: Tx, o: { tenantId: string; customerId: string; channel: Channel; to: string; body: string; purpose: string }) {
  const [log] = await t.insert(messageLog).values({ tenantId: o.tenantId, customerId: o.customerId, channel: o.channel, to: o.to, purpose: o.purpose, body: o.body, templateKey: "auto_reply" }).returning({ id: messageLog.id });
  try {
    // Inside WhatsApp's 24h service window (the customer just wrote), free text is allowed.
    const r = await sendNow({ tenantId: o.tenantId, channel: o.channel, to: o.to, body: o.body });
    await t.update(messageLog).set({ status: "sent", channel: r.channel, provider: r.provider, providerId: r.providerId ?? null, sentAt: new Date() }).where(eq(messageLog.id, log.id));
  } catch (e) {
    await t.update(messageLog).set({ status: "failed", error: (e as Error).message.slice(0, 500) }).where(eq(messageLog.id, log.id));
  }
}

/** Handles one inbound WhatsApp/SMS message: logs it (direction "in"), then acts on recognised commands. */
export async function handleInbound(o: { channel: Channel; from: string; text: string; provider: string; providerId?: string | null }) {
  const phone = senderE164(o.from);
  const who = await identifySender(phone);
  if (!who) return { status: "unknown_sender" as const };
  const { tenantId, id: customerId } = who;
  if (o.providerId) {
    const [seen] = await adminDb().select({ id: messageLog.id }).from(messageLog).where(and(eq(messageLog.providerId, o.providerId), eq(messageLog.direction, "in"))).limit(1);
    if (seen) return { status: "duplicate" as const }; // providers retry webhooks
  }
  let cmd = parseCommand(o.text);
  return withTenant(tenantId, async (t) => {
    const [tenant] = await t.select().from(tenants).where(eq(tenants.id, tenantId));
    const [c] = await t.select().from(customers).where(eq(customers.id, customerId));
    const today = localDay(tenant.timezone);

    // "1" / YES only means "refill please" when it answers a refill reminder we sent recently.
    let rx: typeof prescriptions.$inferSelect | undefined;
    if (cmd.kind === "refill") {
      const since = new Date(Date.now() - REFILL_REPLY_DAYS * 86400_000);
      const [asked] = await t.select({ id: messageLog.id }).from(messageLog)
        .where(and(eq(messageLog.customerId, customerId), eq(messageLog.direction, "out"), eq(messageLog.purpose, "refill"), gte(messageLog.createdAt, since))).limit(1);
      if (!asked) cmd = { kind: "unknown" };
      else [rx] = await t.select().from(prescriptions).where(and(eq(prescriptions.customerId, customerId), eq(prescriptions.status, "active")))
        .orderBy(prescriptions.nextRefillDue).limit(1);
    }

    await t.insert(messageLog).values({
      tenantId, customerId, channel: o.channel, to: phone, purpose: PURPOSE[cmd.kind], body: o.text.slice(0, 4000), status: "delivered",
      provider: o.provider, providerId: o.providerId ?? null, direction: "in", templateKey: cmd.kind === "unknown" ? null : `cmd:${cmd.kind}`, sentAt: new Date(),
    });
    const send = (body: string) => reply(t, { tenantId, customerId, channel: o.channel, to: phone, body, purpose: PURPOSE[cmd.kind] });

    if (cmd.kind === "stop" || cmd.kind === "start") {
      await t.insert(auditLog).values({ tenantId, userId: null, action: "update", entity: "customer", entityId: customerId, customerId, details: { consent: cmd.kind === "stop" ? "opted_out" : "opted_in", via: o.channel } });
    }
    switch (cmd.kind) {
      case "refill": {
        const branchId = rx?.branchId ?? (await lastBranch(t, customerId)) ?? (await mainBranch(t, tenantId));
        const items = rx ? (await t.select({ name: prescriptionItems.drugName }).from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rx.id))).map((i) => i.name).join(", ") : "";
        const [a] = await t.insert(alerts).values({
          tenantId, branchId, kind: "refill_due", customerId, dueOn: rx?.nextRefillDue ?? today,
          dedupeKey: `refillreq:${rx?.id ?? customerId}:${rx?.nextRefillDue ?? today}`,
          title: `${c.name} asked for a refill`,
          detail: `${rx ? `${rx.rxNo}${items ? `: ${items}` : ""}. ` : ""}Replied "${o.text.trim().slice(0, 40)}" by ${o.channel === "whatsapp" ? "WhatsApp" : "SMS"}. Get it ready and let them know${c.phone ? ` on ${c.phone}` : ""}.`,
        }).onConflictDoNothing().returning({ id: alerts.id });
        if (a) await emit(t, tenantId, "alert.raised", { id: a.id, kind: "refill_due", branchId, title: `${c.name} asked for a refill`, customerId });
        await send(`Thank you. ${tenant.name} will get your refill ready and let you know when to collect it.`);
        break;
      }
      case "stop":
        await t.update(customers).set({ optedOutAt: new Date() }).where(eq(customers.id, customerId));
        await send(`You've been unsubscribed from ${tenant.name} messages. Reply START to subscribe again.`);
        break;
      case "start":
        await t.update(customers).set({ optedOutAt: null, messagingConsent: true, consentRecordedAt: new Date(), consentMethod: o.channel === "whatsapp" ? "whatsapp" : "sms" }).where(eq(customers.id, customerId));
        await send(`You're subscribed to messages from ${tenant.name} again. Reply STOP to opt out.`);
        break;
    }
    return { status: "ok" as const, tenantId, customerId, command: cmd.kind };
  });
}

async function lastBranch(t: Tx, customerId: string) {
  const [s] = await t.select({ b: sales.branchId }).from(sales).where(eq(sales.customerId, customerId)).orderBy(desc(sales.soldAt)).limit(1);
  return s?.b ?? null;
}
async function mainBranch(t: Tx, tenantId: string) {
  const [b] = await t.select({ id: branches.id }).from(branches).where(eq(branches.tenantId, tenantId)).orderBy(desc(branches.isMain), branches.createdAt).limit(1);
  return b.id;
}
