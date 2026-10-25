import { eq, ne } from "drizzle-orm";
import { adminDb, withTenant } from "@/db";
import { jobs, tenants } from "@/db/schema";
import { runAlerts } from "@/lib/alerts-engine";
import { localDay, zonedToUtc } from "@/lib/format";
import { sendOwnerSummary } from "@/lib/owner-summary";
import { accessLevel, hasFeature } from "@/lib/plans";

/** Per-tenant nightly sweep: the alerts engine (expiry, stock, recalls, return windows, refills). Idempotent. */
export async function dailyTenant(tenantId: string, today?: string) {
  const [tenant] = await adminDb().select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return null;
  return withTenant(tenantId, (t) => runAlerts(t, tenant, today ?? localDay(tenant.timezone)));
}

/** End-of-day owner summary for `day` (deduped per day inside sendOwnerSummary). */
export async function ownerSummary(tenantId: string, day?: string) {
  const [tenant] = await adminDb().select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant || !hasFeature(tenant, "owner_summary")) return null;
  return withTenant(tenantId, (t) => sendOwnerSummary(t, tenant, day ?? localDay(tenant.timezone)));
}

/** Platform-wide: unpaid past grace → read_only; trials past their end → past_due. */
export async function billingSweep(now = new Date()) {
  const db = adminDb();
  const all = await db.select().from(tenants).where(ne(tenants.planStatus, "cancelled"));
  for (const t of all) {
    if (t.planStatus !== "read_only" && accessLevel(t, now) === "read_only") {
      await db.update(tenants).set({ planStatus: "read_only" }).where(eq(tenants.id, t.id));
    } else if (t.planStatus === "trialing" && t.trialEndsAt && t.trialEndsAt < now) {
      // accessLevel() measures grace from currentPeriodEnd once out of trial, so carry the trial end over.
      await db.update(tenants).set({ planStatus: "past_due", currentPeriodEnd: t.currentPeriodEnd ?? t.trialEndsAt }).where(eq(tenants.id, t.id));
    }
  }
}

export const NIGHTLY_AT = "02:00";

/**
 * Enqueues daily.tenant at 02:00 pharmacy time, owner.summary at the tenant's summary time (when the plan includes it),
 * billing.sweep hourly and fx.refresh daily. Safe to call often (dedupe keys).
 */
export async function scheduleRecurring(now = new Date()) {
  const db = adminDb();
  const hour = now.toISOString().slice(0, 13);
  const rows: (typeof jobs.$inferInsert)[] = [
    { tenantId: null, type: "billing.sweep", payload: {}, runAt: now, dedupeKey: `billing:${hour}` },
    { tenantId: null, type: "fx.refresh", payload: {}, runAt: now, dedupeKey: `fx:${now.toISOString().slice(0, 10)}` },
  ];
  const list = await db.select({ id: tenants.id, tz: tenants.timezone, plan: tenants.plan, planStatus: tenants.planStatus, at: tenants.ownerSummaryTime })
    .from(tenants).where(ne(tenants.planStatus, "cancelled"));
  for (const t of list) {
    const day = localDay(t.tz, now);
    rows.push({ tenantId: t.id, type: "daily.tenant", payload: { day }, runAt: zonedToUtc(day, NIGHTLY_AT, t.tz), dedupeKey: `daily:${t.id}:${day}` });
    if (hasFeature(t, "owner_summary") && /^\d{2}:\d{2}$/.test(t.at)) {
      rows.push({ tenantId: t.id, type: "owner.summary", payload: { day }, runAt: zonedToUtc(day, t.at, t.tz), dedupeKey: `owner:${t.id}:${day}` });
    }
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(jobs).values(rows.slice(i, i + 500)).onConflictDoNothing();
}
