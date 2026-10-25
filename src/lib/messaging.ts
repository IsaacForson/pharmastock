import { and, eq } from "drizzle-orm";
import { adminDb, type Tx } from "@/db";
import { customers, integrations, jobs, messageLog, messageTemplates, tenants } from "@/db/schema";
import { e164 } from "./format";

export type Channel = "whatsapp" | "sms" | "email";
type SendResult = { provider: string; providerId?: string };

/** Per-tenant credentials from the integrations table, falling back to platform env. */
async function providerConfig(tenantId: string | null, provider: string): Promise<Record<string, string> | null> {
  if (tenantId) {
    const [row] = await adminDb().select().from(integrations)
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider), eq(integrations.active, true))).limit(1);
    if (row) return JSON.parse(row.config);
  }
  const env = process.env;
  switch (provider) {
    case "whatsapp": return env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? { token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID } : null;
    case "twilio": return env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM ?? "" } : null;
    case "africastalking": return env.AFRICASTALKING_API_KEY ? { username: env.AFRICASTALKING_USERNAME ?? "sandbox", apiKey: env.AFRICASTALKING_API_KEY, from: env.AFRICASTALKING_FROM ?? "" } : null;
    case "resend": return env.RESEND_API_KEY ? { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? "" } : null;
  }
  return null;
}

async function whatsapp(cfg: Record<string, string>, to: string, body: string, template?: { name: string; language: string; params: string[] }): Promise<SendResult> {
  // Outside the 24h service window Meta requires a pre-approved template; free text is used inside it.
  const payload = template
    ? { messaging_product: "whatsapp", to: to.replace("+", ""), type: "template", template: { name: template.name, language: { code: template.language }, components: [{ type: "body", parameters: template.params.map((text) => ({ type: "text", text })) }] } }
    : { messaging_product: "whatsapp", to: to.replace("+", ""), type: "text", text: { body, preview_url: true } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phoneNumberId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`WhatsApp: ${json?.error?.message ?? res.status}`);
  return { provider: "whatsapp", providerId: json.messages?.[0]?.id };
}

async function sms(tenantId: string | null, to: string, body: string): Promise<SendResult> {
  const at = await providerConfig(tenantId, "africastalking");
  if (at) {
    const form = new URLSearchParams({ username: at.username, to, message: body, ...(at.from ? { from: at.from } : {}) });
    const host = at.username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
    const res = await fetch(`https://${host}/version1/messaging`, { method: "POST", headers: { apiKey: at.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const json = await res.json();
    const r = json?.SMSMessageData?.Recipients?.[0];
    if (!res.ok || !r || r.statusCode >= 400) throw new Error(`Africa's Talking: ${r?.status ?? json?.SMSMessageData?.Message ?? res.status}`);
    return { provider: "africastalking", providerId: r.messageId };
  }
  const tw = await providerConfig(tenantId, "twilio");
  if (tw) {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tw.sid}/Messages.json`, {
      method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${tw.sid}:${tw.token}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: tw.from, Body: body }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Twilio: ${json?.message ?? res.status}`);
    return { provider: "twilio", providerId: json.sid };
  }
  return devLog("sms", to, body);
}

async function email(tenantId: string | null, to: string, subject: string, body: string): Promise<SendResult> {
  const cfg = await providerConfig(tenantId, "resend");
  if (!cfg) return devLog("email", to, `${subject}\n${body}`);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.from, to, subject, text: body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Resend: ${json?.message ?? res.status}`);
  return { provider: "resend", providerId: json.id };
}

function devLog(channel: string, to: string, body: string): SendResult {
  if (process.env.NODE_ENV === "production") throw new Error(`No ${channel} provider configured`);
  console.log(`\n[dev ${channel} → ${to}]\n${body}\n`);
  return { provider: "dev-log" };
}

/** Send immediately. WhatsApp falls back to SMS when not configured or when it fails. */
export async function sendNow(opts: { tenantId: string | null; channel: Channel; to: string; body: string; subject?: string; waTemplate?: { name: string; language: string; params: string[] } }): Promise<SendResult & { channel: Channel }> {
  const { tenantId, channel, to, body } = opts;
  if (channel === "email") return { ...(await email(tenantId, to, opts.subject ?? "Message from your pharmacy", body)), channel };
  if (channel === "whatsapp") {
    const cfg = await providerConfig(tenantId, "whatsapp");
    if (cfg) {
      try {
        return { ...(await whatsapp(cfg, to, body, opts.waTemplate)), channel };
      } catch (e) {
        console.warn("WhatsApp failed, falling back to SMS:", (e as Error).message);
      }
    }
  }
  return { ...(await sms(tenantId, to, body)), channel: "sms" };
}

export const DEFAULT_TEMPLATES: Record<string, string> = {
  receipt: "Thank you for shopping at {{pharmacy}}. Receipt {{sale}}: {{amount}}. View it here: {{link}}",
  refill_due: "Hello {{name}}, your {{items}} from {{pharmacy}} is due for a refill around {{date}}. Reply 1 and we'll have it ready. Reply STOP to opt out.",
  balance_due: "Hello {{name}}, your account at {{pharmacy}} has {{amount}} outstanding. Thank you.",
  order_ready: "Hello {{name}}, your order {{sale}} from {{pharmacy}} is {{status}}.",
  owner_summary: "{{body}}",
  purchase_order: "Hello {{supplier}}, {{pharmacy}} has sent purchase order {{po}} ({{lines}} items, about {{amount}}). View and confirm: {{link}}",
};

export const render = (tpl: string, vars: Record<string, string | number | null | undefined>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ""));

/** Purposes a customer must have opted in to. Receipts and order updates are sent only when the customer asks at the till. */
const NEEDS_CONSENT = new Set(["refill", "marketing", "balance"]);

/**
 * Queue a templated message to a customer. Checks consent (opt-out always wins), renders the tenant's template, logs the
 * purpose, and schedules delivery via the jobs table. Returns null when skipped.
 */
export async function queueCustomerMessage(t: Tx, o: {
  tenantId: string; customerId: string; templateKey: string; purpose: string; vars: Record<string, string | number | null | undefined>;
  runAt?: Date; dedupeKey?: string; channel?: Channel;
}) {
  const [c] = await t.select().from(customers).where(eq(customers.id, o.customerId)).limit(1);
  const [tenant] = await t.select().from(tenants).where(eq(tenants.id, o.tenantId)).limit(1);
  if (!c || !tenant || c.optedOutAt) return null;
  if (NEEDS_CONSENT.has(o.purpose) && !c.messagingConsent) return null;
  const channel = o.channel ?? c.preferredChannel;
  const to = channel === "email" ? c.email : e164(c.phone, tenant.country);
  const [tpl] = await t.select().from(messageTemplates)
    .where(and(eq(messageTemplates.key, o.templateKey), eq(messageTemplates.language, "en"), eq(messageTemplates.active, true))).limit(1);
  const tplBody = tpl?.body ?? DEFAULT_TEMPLATES[o.templateKey] ?? "";
  const vars = { name: c.name.split(" ")[0], pharmacy: tenant.name, ...o.vars };
  return logAndQueue(t, { tenantId: o.tenantId, customerId: c.id, channel, to, templateKey: o.templateKey, purpose: o.purpose, tplBody, vars, waTemplate: tpl?.waTemplateName ?? null, runAt: o.runAt, dedupeKey: o.dedupeKey });
}

/** Queue a message to staff or a supplier (owner summary, purchase orders). No consent check: it is business correspondence. */
export async function queueDirectMessage(t: Tx, o: {
  tenantId: string; to: string; channel: Channel; templateKey: string; purpose: string; vars: Record<string, string | number | null | undefined>;
  supplierId?: string | null; runAt?: Date; dedupeKey?: string;
}) {
  const [tpl] = await t.select().from(messageTemplates)
    .where(and(eq(messageTemplates.key, o.templateKey), eq(messageTemplates.language, "en"), eq(messageTemplates.active, true))).limit(1);
  return logAndQueue(t, { ...o, tplBody: tpl?.body ?? DEFAULT_TEMPLATES[o.templateKey] ?? "", waTemplate: tpl?.waTemplateName ?? null });
}

async function logAndQueue(t: Tx, o: {
  tenantId: string; customerId?: string | null; supplierId?: string | null; channel: Channel; to: string | null; templateKey: string; purpose: string;
  tplBody: string; vars: Record<string, string | number | null | undefined>; waTemplate: string | null; runAt?: Date; dedupeKey?: string;
}) {
  if (o.dedupeKey) {
    const [dup] = await t.select({ id: jobs.id }).from(jobs).where(eq(jobs.dedupeKey, o.dedupeKey)).limit(1);
    if (dup) return null;
  }
  const body = render(o.tplBody, o.vars);
  // WhatsApp template parameters in placeholder order (Meta rejects empty parameters).
  const waParams = [...o.tplBody.matchAll(/\{\{(\w+)\}\}/g)].map((m) => String(o.vars[m[1]] ?? "").trim() || "-");
  const [log] = await t.insert(messageLog).values({
    tenantId: o.tenantId, customerId: o.customerId ?? null, supplierId: o.supplierId ?? null, channel: o.channel, to: o.to ?? "",
    templateKey: o.templateKey, purpose: o.purpose, body, status: o.to ? "queued" : "skipped", error: o.to ? null : "No contact on file",
  }).returning({ id: messageLog.id });
  if (!o.to) return null;
  await t.insert(jobs).values({
    tenantId: o.tenantId, type: "message.send", payload: { messageId: log.id, waTemplate: o.waTemplate, waParams },
    runAt: o.runAt ?? new Date(), dedupeKey: o.dedupeKey,
  }).onConflictDoNothing();
  return log.id;
}
