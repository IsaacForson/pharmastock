import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { integrations } from "@/db/schema";
import { randomToken } from "./crypto";

/** Tenant's own Paystack key for customer payments (money goes to the pharmacy), else the platform key. */
export async function paystackKey(tenantId: string | null): Promise<string | null> {
  if (tenantId) {
    const [row] = await adminDb().select().from(integrations).where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, "paystack"), eq(integrations.active, true)));
    if (row) return JSON.parse(row.config).secretKey ?? null;
  }
  return process.env.PAYSTACK_SECRET_KEY || null;
}

async function call<T>(key: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.paystack.co${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok || json.status === false) throw new Error(`Paystack: ${json.message ?? res.status}`);
  return json.data as T;
}

/**
 * Hosted checkout (card + mobile money). metadata.kind routes the webhook:
 *  "subscription" {tenantId, plan, cycle, branches} | "setup" {tenantId, tier}
 */
export async function initializePayment(o: {
  tenantId: string | null; email: string; amountMinor: number; currency: string; metadata: Record<string, unknown>;
  callbackUrl?: string; plan?: string;
}): Promise<{ url: string; reference: string } | null> {
  const key = await paystackKey(o.tenantId);
  if (!key) return null;
  const reference = `ps_${randomToken(12)}`;
  const data = await call<{ authorization_url: string; reference: string }>(key, "/transaction/initialize", {
    email: o.email, amount: o.amountMinor, currency: o.currency, reference, metadata: o.metadata,
    callback_url: o.callbackUrl, channels: ["card", "mobile_money", "bank_transfer", "ussd"], ...(o.plan ? { plan: o.plan } : {}),
  });
  return { url: data.authorization_url, reference: data.reference };
}

export async function verifyTransaction(tenantId: string | null, reference: string) {
  const key = await paystackKey(tenantId);
  if (!key) throw new Error("Paystack not configured");
  return call<{ status: string; amount: number; currency: string; reference: string; channel: string; metadata: Record<string, unknown> }>(key, `/transaction/verify/${encodeURIComponent(reference)}`);
}

/** Webhook signature: HMAC-SHA512 of the raw body with the secret key. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secretKey: string) {
  if (!signature) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Full or partial refund of a Paystack transaction. Returns Paystack's refund id. */
export async function refundTransaction(tenantId: string | null, reference: string, amountMinor: number): Promise<string> {
  const key = await paystackKey(tenantId);
  if (!key) throw new Error("Paystack is not configured, so this payment can't be refunded automatically");
  const data = await call<{ id?: number | string }>(key, "/refund", { transaction: reference, amount: amountMinor });
  return String(data?.id ?? reference);
}
