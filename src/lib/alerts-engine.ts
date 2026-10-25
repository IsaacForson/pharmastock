/**
 * Nightly alerts engine (job `daily.tenant`, ~02:00 pharmacy time). Per branch it raises or refreshes alerts for expiry
 * thresholds, expired stock, low / out of stock, closing supplier return windows, recalls (and quarantines the matching
 * batches) and refills due, then closes alerts that no longer apply. Idempotent: every alert has a dedupe key, open ones
 * are refreshed in place, and done/dismissed ones are never reopened.
 */
import { and, eq, gt, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { alerts, auditLog, branches, customers, prescriptionItems, prescriptions, products, recalls, saleLines, sales, stockBatches, stockMovements, suppliers, type Tenant } from "@/db/schema";
import { suggestExpiryAction } from "./analytics";
import { emit } from "./events";
import { addDays, dateOnly, dayRange, localDay } from "./format";
import { queueCustomerMessage } from "./messaging";
import { reorderSuggestions, VELOCITY_DAYS } from "./reorder";

type AlertKind = (typeof alerts.$inferInsert)["kind"];
type NewAlert = { branchId: string; kind: AlertKind; dedupeKey: string; title: string; detail?: string | null; valueMinor?: number; dueOn?: string | null; productId?: string | null; batchId?: string | null; customerId?: string | null };

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

/** Expiry thresholds (days) the batch has crossed: the tightest one wins. null = not near expiry yet; -1 = expired. */
export function expiryThreshold(daysLeft: number, thresholds: number[]): number | null {
  if (daysLeft < 0) return -1;
  const hit = [...thresholds].filter((d) => d > 0).sort((a, b) => a - b).find((d) => daysLeft <= d);
  return hit ?? null;
}
/** The alert kind for a threshold (the enum has 90/60/30; other configured thresholds map to the nearest bucket). */
export const expiryKind = (threshold: number): AlertKind => (threshold < 0 ? "expired" : threshold <= 30 ? "expiry_30" : threshold <= 60 ? "expiry_60" : "expiry_90");

/** Date (YYYY-MM-DD) after which the supplier will no longer take this batch back, or null when they never would. */
export function returnDeadline(o: { expiry: string; receivedDay: string; minDaysToExpiry: number; withinDaysOfDelivery: number }): string | null {
  const byExpiry = addDays(o.expiry, -o.minDaysToExpiry);
  const byDelivery = o.withinDaysOfDelivery > 0 ? addDays(o.receivedDay, o.withinDaysOfDelivery) : null;
  const d = byDelivery && byDelivery < byExpiry ? byDelivery : byExpiry;
  return d >= o.receivedDay ? d : null;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: string | null | undefined) => norm(s).split(" ").filter(Boolean);
const containsAll = (hay: string[], needle: string[]) => needle.length > 0 && needle.every((n) => hay.includes(n));
const fuzzyCompany = (a: string | null | undefined, b: string | null | undefined) => {
  // "GSK" vs "GlaxoSmithKline plc": compare the first significant word or a prefix of the squashed name.
  const [x, y] = [norm(a).replace(/\b(ltd|limited|plc|inc|pharma|pharmaceuticals?|laboratories|labs?|co|company|industries)\b/g, "").replace(/\s+/g, ""), norm(b).replace(/\b(ltd|limited|plc|inc|pharma|pharmaceuticals?|laboratories|labs?|co|company|industries)\b/g, "").replace(/\s+/g, "")];
  return !!x && !!y && (x.startsWith(y) || y.startsWith(x));
};

/**
 * Does a recall notice cover this batch? Brand name match (all words of the recalled name appear in the product name +
 * strength) or generic name match; the manufacturer must not contradict; listed batch numbers must include this one.
 * A generic-name-only match is too broad on its own, so it also needs a manufacturer or batch-number match.
 */
export function recallMatches(r: { productName: string; genericName: string | null; manufacturer: string | null; batchNos: string[] },
  p: { name: string; strength: string | null; genericName: string | null; manufacturer: string | null }, batchNo: string) {
  const batchListed = r.batchNos.length > 0;
  const batchOk = !batchListed || r.batchNos.some((b) => norm(b).replace(/\s/g, "") === norm(batchNo).replace(/\s/g, "") && norm(batchNo) !== "");
  if (!batchOk) return false;
  const mfrKnown = !!r.manufacturer && !!p.manufacturer;
  if (mfrKnown && !fuzzyCompany(r.manufacturer, p.manufacturer)) return false;
  const brand = containsAll(tokens(`${p.name} ${p.strength ?? ""}`), tokens(r.productName));
  if (brand) return true;
  const generic = !!r.genericName && !!p.genericName && (norm(r.genericName) === norm(p.genericName) || containsAll(tokens(p.genericName), tokens(r.genericName)));
  return generic && (mfrKnown || batchListed);
}

/** Inserts a new alert or refreshes the text/value of an open one. Never touches done/dismissed alerts. Returns true when new. */
async function upsert(t: Tx, tenantId: string, a: NewAlert): Promise<boolean> {
  const [row] = await t.insert(alerts).values({
    tenantId, branchId: a.branchId, kind: a.kind, dedupeKey: a.dedupeKey, title: a.title, detail: a.detail ?? null, valueMinor: Math.round(a.valueMinor ?? 0),
    dueOn: a.dueOn ?? null, productId: a.productId ?? null, batchId: a.batchId ?? null, customerId: a.customerId ?? null,
  }).onConflictDoUpdate({
    target: [alerts.tenantId, alerts.dedupeKey],
    set: { title: a.title, detail: a.detail ?? null, valueMinor: Math.round(a.valueMinor ?? 0), dueOn: a.dueOn ?? null },
    setWhere: eq(alerts.status, "open"),
  }).returning({ id: alerts.id, inserted: sql<boolean>`(xmax = 0)` });
  if (row?.inserted) {
    await emit(t, tenantId, "alert.raised", { id: row.id, kind: a.kind, branchId: a.branchId, title: a.title, valueMinor: Math.round(a.valueMinor ?? 0), productId: a.productId ?? null, batchId: a.batchId ?? null, dueOn: a.dueOn ?? null });
  }
  return !!row?.inserted;
}

async function close(t: Tx, ids: string[], resolution: string) {
  if (!ids.length) return 0;
  await t.update(alerts).set({ status: "done", resolution, resolvedAt: new Date() }).where(and(inArray(alerts.id, ids), eq(alerts.status, "open")));
  return ids.length;
}

export type AlertsRun = { raised: number; closed: number; quarantined: number; refillMessages: number };

/** Runs inside withTenant(tenant.id). `today` is the pharmacy's local day (overridable for tests). */
export async function runAlerts(t: Tx, tenant: Pick<Tenant, "id" | "name" | "timezone" | "country" | "expiryAlertDays" | "reorderCoverDays">, today = localDay(tenant.timezone)): Promise<AlertsRun> {
  const out: AlertsRun = { raised: 0, closed: 0, quarantined: 0, refillMessages: 0 };
  const tenantId = tenant.id;
  const raise = async (a: NewAlert) => { if (await upsert(t, tenantId, a)) out.raised++; };
  const branchRows = await t.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.tenantId, tenantId), eq(branches.active, true)));
  const branchName = new Map(branchRows.map((b) => [b.id, b.name]));
  const maxThreshold = Math.max(90, ...tenant.expiryAlertDays);

  // Sales pace per product per branch (base units/day), for expiry suggestions and return-window urgency.
  const since = dayRange(addDays(today, -VELOCITY_DAYS), tenant.timezone).start.toISOString();
  const pace = await t.select({ productId: saleLines.productId, branchId: sales.branchId, n: sql<number>`sum(${saleLines.baseQty} - ${saleLines.returnedBaseQty})::int` })
    .from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(ne(sales.status, "voided"), gte(sales.soldAt, sql`${since}::timestamptz`))).groupBy(saleLines.productId, sales.branchId);
  const daily = (productId: string, branchId: string) => (pace.find((p) => p.productId === productId && p.branchId === branchId)?.n ?? 0) / VELOCITY_DAYS;
  const fastest = (productId: string, notBranch: string) => {
    const best = pace.filter((p) => p.productId === productId && p.branchId !== notBranch && branchName.has(p.branchId)).sort((a, b) => b.n - a.n)[0];
    return best ? { name: branchName.get(best.branchId)!, dailySales: best.n / VELOCITY_DAYS } : null;
  };

  // ---- Expiry, expired and supplier return windows ----
  const batches = await t.select({ b: stockBatches, p: products, s: suppliers }).from(stockBatches)
    .innerJoin(products, eq(products.id, stockBatches.productId)).leftJoin(suppliers, eq(suppliers.id, stockBatches.supplierId))
    .where(and(gt(stockBatches.qtyOnHand, 0), isNotNull(stockBatches.expiry), lte(stockBatches.expiry, addDays(today, Math.max(maxThreshold, 365)))));
  for (const { b, p, s } of batches) {
    if (!branchName.has(b.branchId)) continue;
    const daysLeft = daysBetween(today, b.expiry!);
    const value = b.qtyOnHand * b.unitCostMinor;
    const receivedDay = localDay(tenant.timezone, b.receivedAt);
    const deadline = s ? returnDeadline({ expiry: b.expiry!, receivedDay, minDaysToExpiry: s.returnMinDaysToExpiry, withinDaysOfDelivery: s.returnWithinDaysOfDelivery }) : null;
    const returnable = !!deadline && deadline >= today;
    const pacePerDay = daily(p.id, b.branchId);
    const label = `${p.name}${p.strength ? ` ${p.strength}` : ""}${b.batchNo ? ` · batch ${b.batchNo}` : ""}`;

    const th = expiryThreshold(daysLeft, tenant.expiryAlertDays);
    if (th !== null) {
      const sug = suggestExpiryAction({ daysLeft, qty: b.qtyOnHand, dailySales: pacePerDay, returnable, fasterBranch: fastest(p.id, b.branchId) });
      const key = th < 0 ? `expired:${b.id}` : `exp${th}:${b.id}`;
      await raise({
        branchId: b.branchId, kind: expiryKind(th), dedupeKey: key, productId: p.id, batchId: b.id, valueMinor: value, dueOn: b.expiry,
        title: th < 0 ? `${label} has expired` : `${label} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        detail: `${b.qtyOnHand} ${p.baseUnit}${b.qtyOnHand === 1 ? "" : "s"} expire${th < 0 ? "d" : ""} on ${dateOnly(`${b.expiry}T12:00:00Z`, tenant.timezone)}.${s ? ` Supplier: ${s.name}${returnable ? `, returns accepted until ${dateOnly(`${deadline}T12:00:00Z`, tenant.timezone)}` : ""}.` : ""} Suggested: ${sug.text}`,
      });
      // A tighter threshold supersedes the earlier ones for the same batch.
      const older = await t.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.batchId, b.id), eq(alerts.status, "open"),
        inArray(alerts.kind, ["expiry_90", "expiry_60", "expiry_30", "expired"]), ne(alerts.dedupeKey, key)));
      out.closed += await close(t, older.map((x) => x.id), "superseded");
    }
    // Return window closing within 14 days on stock that won't sell in time.
    if (returnable && daysBetween(today, deadline!) <= 14 && pacePerDay * daysLeft < b.qtyOnHand) {
      const left = daysBetween(today, deadline!);
      await raise({
        branchId: b.branchId, kind: "return_window", dedupeKey: `retwin:${b.id}:${deadline}`, productId: p.id, batchId: b.id, valueMinor: value, dueOn: deadline,
        title: `Last ${left === 0 ? "day" : `${left} day${left === 1 ? "" : "s"}`} to return ${label} to ${s!.name}`,
        detail: `${b.qtyOnHand} ${p.baseUnit}s won't sell before expiry (${dateOnly(`${b.expiry}T12:00:00Z`, tenant.timezone)}) at the current pace. ${s!.name} takes stock back with at least ${s!.returnMinDaysToExpiry} days to expiry.`,
      });
    }
  }

  // ---- Low and out of stock (per branch, from the reorder engine) ----
  const lastReceived = await t.select({ productId: stockMovements.productId, branchId: stockMovements.branchId, at: sql<string>`max(${stockMovements.createdAt})::date::text` })
    .from(stockMovements).where(inArray(stockMovements.type, ["receive", "transfer_in"])).groupBy(stockMovements.productId, stockMovements.branchId);
  const cycle = (productId: string, branchId: string) => lastReceived.find((r) => r.productId === productId && r.branchId === branchId)?.at ?? "none";
  for (const br of branchRows) {
    const list = await reorderSuggestions(t, { tenant: { id: tenantId, timezone: tenant.timezone, reorderCoverDays: tenant.reorderCoverDays }, branchId: br.id });
    const needed = new Set(list.map((s) => s.productId));
    for (const s of list) {
      const oos = s.reason === "out_of_stock";
      // The stock cycle (last delivery) is part of the key: a dismissed alert stays dismissed until the item is restocked and runs low again.
      const key = `${oos ? "oos" : "low"}:${br.id}:${s.productId}:${cycle(s.productId, br.id)}`;
      await raise({
        branchId: br.id, kind: oos ? "out_of_stock" : "low_stock", dedupeKey: key, productId: s.productId, valueMinor: s.estCostMinor ?? 0,
        title: oos ? `${s.name}${s.strength ? ` ${s.strength}` : ""} is out of stock` : `${s.name}${s.strength ? ` ${s.strength}` : ""} is running low`,
        detail: `${s.onHand} ${s.baseUnit}s left${s.onOrder ? `, ${s.onOrder} on order` : ""}${s.daysOfCover !== null ? ` (about ${Math.floor(s.daysOfCover)} days of sales)` : ""}. Suggested order: ${s.packs} × ${s.unitName}${s.supplierName ? ` from ${s.supplierName}` : ""}.`,
      });
      const other = await t.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.branchId, br.id), eq(alerts.productId, s.productId), eq(alerts.status, "open"),
        eq(alerts.kind, oos ? "low_stock" : "out_of_stock")));
      out.closed += await close(t, other.map((x) => x.id), "superseded");
    }
    const stale = await t.select({ id: alerts.id, productId: alerts.productId }).from(alerts)
      .where(and(eq(alerts.branchId, br.id), eq(alerts.status, "open"), inArray(alerts.kind, ["low_stock", "out_of_stock"])));
    out.closed += await close(t, stale.filter((a) => !a.productId || !needed.has(a.productId)).map((a) => a.id), "restocked");
  }

  // ---- Recalls ----
  const notices = await t.select().from(recalls).where(or(sql`${recalls.country} is null`, eq(recalls.country, tenant.country)));
  if (notices.length) {
    const live = await t.select({ b: stockBatches, p: products }).from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId)).where(gt(stockBatches.qtyOnHand, 0));
    for (const r of notices) {
      for (const { b, p } of live) {
        if (!branchName.has(b.branchId) || !recallMatches(r, p, b.batchNo)) continue;
        const isNew = await upsert(t, tenantId, {
          branchId: b.branchId, kind: "recall", dedupeKey: `recall:${r.id}:${b.id}`, productId: p.id, batchId: b.id, valueMinor: b.qtyOnHand * b.unitCostMinor, dueOn: today,
          title: `Recall: ${p.name}${b.batchNo ? ` batch ${b.batchNo}` : ""} has been quarantined`,
          detail: `${r.reason}${r.source ? ` (source: ${r.source})` : ""}. Published ${dateOnly(`${r.publishedOn}T12:00:00Z`, tenant.timezone)}. ${b.qtyOnHand} ${p.baseUnit}s are blocked from sale. Return them to the supplier or destroy them as the notice instructs.`,
        });
        // Quarantine only on first match, so a pharmacist who released a false match is not overruled every night.
        if (isNew) {
          out.raised++;
          if (!b.quarantined) {
            const reason = `Recall: ${r.reason}`.slice(0, 500);
            await t.update(stockBatches).set({ quarantined: true, quarantineReason: reason }).where(eq(stockBatches.id, b.id));
            await t.insert(auditLog).values({ tenantId, userId: null, action: "quarantine", entity: "stock_batch", entityId: b.id, details: { recallId: r.id, reason, via: "nightly_alerts" } });
            out.quarantined++;
          }
        }
      }
    }
  }

  // ---- Refills due within 3 days (and up to a week overdue) ----
  const due = await t.select({ rx: prescriptions, c: customers }).from(prescriptions).innerJoin(customers, eq(customers.id, prescriptions.customerId))
    .where(and(eq(prescriptions.status, "active"), isNotNull(prescriptions.nextRefillDue), gte(prescriptions.nextRefillDue, addDays(today, -7)), lte(prescriptions.nextRefillDue, addDays(today, 3))));
  for (const { rx, c } of due) {
    if (c.deletedAt) continue;
    const items = await t.select({ name: prescriptionItems.drugName }).from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rx.id));
    const names = items.map((i) => i.name).join(", ") || "medicine";
    const when = dateOnly(`${rx.nextRefillDue}T12:00:00Z`, tenant.timezone);
    await raise({
      branchId: rx.branchId, kind: "refill_due", dedupeKey: `refill:${rx.id}:${rx.nextRefillDue}`, customerId: c.id, dueOn: rx.nextRefillDue,
      title: `${c.name}'s refill is due ${rx.nextRefillDue! < today ? `(was ${when})` : when}`, detail: `${rx.rxNo}: ${names}. Prepare it or call ${c.phone ?? "the customer"}.`,
    });
    if (c.phone || c.email) {
      const id = await queueCustomerMessage(t, { tenantId, customerId: c.id, templateKey: "refill_due", purpose: "refill", vars: { items: names, date: when }, dedupeKey: `refillmsg:${rx.id}:${rx.nextRefillDue}` });
      if (id) out.refillMessages++;
    }
  }

  // ---- Auto-close ----
  // Batch alerts whose batch is now empty: say what happened from the batch's last movement.
  const batchAlerts = await t.select({ id: alerts.id, batchId: alerts.batchId }).from(alerts).innerJoin(stockBatches, eq(stockBatches.id, alerts.batchId))
    .where(and(eq(alerts.status, "open"), eq(stockBatches.qtyOnHand, 0), inArray(alerts.kind, ["expiry_90", "expiry_60", "expiry_30", "expired", "return_window", "recall"])));
  if (batchAlerts.length) {
    const last = await t.execute(sql`select distinct on (batch_id) batch_id as "batchId", type::text as type from stock_movements
      where batch_id in ${batchAlerts.map((a) => a.batchId!)} order by batch_id, created_at desc`) as unknown as { batchId: string; type: string }[];
    const RES: Record<string, string> = { expire: "written_off", damage: "written_off", supplier_return: "returned", transfer_out: "transferred", sale: "sold" };
    const byRes = new Map<string, string[]>();
    for (const a of batchAlerts) {
      const res = RES[last.find((l) => l.batchId === a.batchId)?.type ?? ""] ?? "batch_empty";
      byRes.set(res, [...(byRes.get(res) ?? []), a.id]);
    }
    for (const [res, ids] of byRes) out.closed += await close(t, ids, res);
  }
  // Refill alerts whose prescription was filled (next due moved on) or closed.
  const refills = await t.select({ id: alerts.id, key: alerts.dedupeKey, dueOn: alerts.dueOn }).from(alerts).where(and(eq(alerts.status, "open"), eq(alerts.kind, "refill_due")));
  const rxIds = refills.map((a) => /^refill:([0-9a-f-]{36}):/.exec(a.key)?.[1]).filter((x): x is string => !!x);
  if (rxIds.length) {
    const rxs = await t.select({ id: prescriptions.id, status: prescriptions.status, next: prescriptions.nextRefillDue }).from(prescriptions).where(inArray(prescriptions.id, rxIds));
    const filled = refills.filter((a) => {
      const rx = rxs.find((r) => a.key.startsWith(`refill:${r.id}:`));
      return rx && (rx.status !== "active" || (rx.next ?? "") > (a.dueOn ?? ""));
    });
    out.closed += await close(t, filled.map((a) => a.id), "filled");
  }
  return out;
}
