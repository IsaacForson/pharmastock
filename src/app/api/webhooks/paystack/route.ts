import { eq, or } from "drizzle-orm";
import { adminDb } from "@/db";
import { billingEvents, tenants } from "@/db/schema";
import { verifyWebhookSignature } from "@/lib/paystack";
import { CHAIN_MIN_BRANCHES } from "@/lib/plans";

type Evt = {
  event: string;
  data: {
    reference?: string; amount?: number; currency?: string; channel?: string; status?: string;
    metadata?: Record<string, unknown> | string | null; plan?: { plan_code?: string } | string | null;
    customer?: { customer_code?: string; email?: string }; subscription_code?: string; subscription?: { subscription_code?: string };
  };
};

const PLANS = ["starter", "pro", "chain"] as const;
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
const ok = () => new Response("ok");

export async function POST(req: Request) {
  const raw = await req.text();
  let evt: Evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const meta = (typeof evt.data?.metadata === "string" ? safeJson(evt.data.metadata) : evt.data?.metadata) ?? {};
  const kind = typeof meta.kind === "string" ? meta.kind : null;
  const tenantId = isUuid(meta.tenantId) ? meta.tenantId : null;
  const sig = req.headers.get("x-paystack-signature");
  const platformKey = process.env.PAYSTACK_SECRET_KEY;
  const byPlatform = !!platformKey && verifyWebhookSignature(raw, sig, platformKey);

  // Everything here touches the PharmaStock subscription, so it must be signed with the platform key.
  if (!byPlatform) return new Response("Bad signature", { status: 401 });

  if (evt.event === "charge.success" && kind === "subscription" && tenantId) {
    await subscriptionCharge(tenantId, meta, evt);
  } else if (evt.event === "charge.success" && kind === "setup" && tenantId) {
    // One-time setup service: recorded for the team to schedule (shown in Control → Revenue and the pharmacy's billing history).
    await logEvent(tenantId, { ...evt, event: "setup.paid", data: { ...evt.data, metadata: { ...meta } } }, evt.data.reference ?? null);
  } else if (evt.event === "subscription.create") {
    const t = await tenantByCustomer(evt);
    const code = evt.data.subscription_code;
    if (t && code) await adminDb().update(tenants).set({ paystackSubscriptionCode: code }).where(eq(tenants.id, t.id));
  } else if (evt.event === "subscription.disable" || evt.event === "subscription.not_renew" || evt.event === "invoice.payment_failed") {
    const t = await tenantByCustomer(evt);
    if (t) {
      const inserted = await logEvent(t.id, evt, `${evt.event}:${evt.data.subscription_code ?? evt.data.subscription?.subscription_code ?? ""}:${new Date().toISOString().slice(0, 10)}`);
      if (inserted && evt.event !== "subscription.not_renew") await adminDb().update(tenants).set({ planStatus: "past_due" }).where(eq(tenants.id, t.id));
    }
  } else if (evt.event === "charge.success" && !kind) {
    // Recurring plan renewal charged by Paystack itself: no metadata, matched by customer code.
    const t = await tenantByCustomer(evt);
    if (t && (await logEvent(t.id, evt, evt.data.reference ?? null))) await extendPeriod(t.id, t.billingCycle === "annual" ? "annual" : "monthly", {});
  }
  return ok();
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function logEvent(tenantId: string, evt: Evt, providerRef: string | null) {
  const rows = await adminDb().insert(billingEvents).values({
    tenantId, type: evt.event, amountMinor: evt.data.amount ?? null, currency: evt.data.currency ?? null, providerRef, data: evt.data,
  }).onConflictDoNothing({ target: billingEvents.providerRef }).returning({ id: billingEvents.id });
  return rows.length > 0;
}

async function subscriptionCharge(tenantId: string, meta: Record<string, unknown>, evt: Evt) {
  if (!(await logEvent(tenantId, evt, evt.data.reference ?? null))) return; // duplicate delivery
  const customer = evt.data.customer?.customer_code;
  if (customer) await adminDb().update(tenants).set({ paystackCustomerCode: customer }).where(eq(tenants.id, tenantId));
  const cycle = meta.cycle === "annual" ? "annual" : "monthly";
  const plan = PLANS.find((p) => p === meta.plan);
  const branches = Number(meta.branches);
  const billedBranches = plan === "chain" ? Math.max(CHAIN_MIN_BRANCHES, Number.isInteger(branches) ? branches : 0) : plan ? 1 : undefined;
  await extendPeriod(tenantId, cycle, { plan, billedBranches });
}

async function extendPeriod(tenantId: string, cycle: "monthly" | "annual", o: { plan?: (typeof PLANS)[number]; billedBranches?: number }) {
  const [t] = await adminDb().select({ end: tenants.currentPeriodEnd }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t) return;
  const from = t.end && t.end > new Date() ? new Date(t.end) : new Date();
  if (cycle === "annual") from.setUTCFullYear(from.getUTCFullYear() + 1);
  else from.setUTCMonth(from.getUTCMonth() + 1);
  await adminDb().update(tenants).set({
    planStatus: "active", billingCycle: cycle, currentPeriodEnd: from,
    ...(o.plan ? { plan: o.plan } : {}), ...(o.billedBranches !== undefined ? { billedBranches: o.billedBranches } : {}),
  }).where(eq(tenants.id, tenantId));
}

async function tenantByCustomer(evt: Evt) {
  const customer = evt.data.customer?.customer_code;
  const sub = evt.data.subscription_code ?? evt.data.subscription?.subscription_code;
  if (!customer && !sub) return null;
  const [t] = await adminDb().select().from(tenants).where(or(
    customer ? eq(tenants.paystackCustomerCode, customer) : undefined, sub ? eq(tenants.paystackSubscriptionCode, sub) : undefined,
  )).limit(1);
  return t ?? null;
}
