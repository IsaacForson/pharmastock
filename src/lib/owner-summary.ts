/**
 * The owner's end-of-day WhatsApp summary (job `owner.summary`, at tenants.ownerSummaryTime, plan feature `owner_summary`).
 * `gatherSummary` reads the day's numbers per branch; `formatOwnerSummary` is the pure text formatter (unit tested).
 */
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { branches, users, type Tenant } from "@/db/schema";
import { pct } from "./analytics";
import { addDays, dateOnly, dayRange, e164, money } from "./format";
import { queueDirectMessage } from "./messaging";
import { reorderSuggestions } from "./reorder";

export type BranchDay = {
  name: string; salesMinor: number; count: number; revenueExTaxMinor: number; costMinor: number; creditMinor: number;
  payments: Record<string, number>; nearExpiryMinor: number; expiredMinor: number;
  voids: { n: number; minor: number }; returns: { n: number; minor: number }; discrepancies: number;
};
export type SummaryData = { pharmacy: string; dayLabel: string; currency: string; branches: BranchDay[]; reorder: { name: string; branch?: string; packs: number; unit: string }[] };

const METHOD: Record<string, string> = { cash: "Cash", mobile_money: "MoMo", card: "Card", bank: "Bank", insurance: "Insurance", credit: "Account", loyalty: "Points" };

export function totalOf(list: BranchDay[]): BranchDay {
  const sum = (f: (b: BranchDay) => number) => list.reduce((s, b) => s + f(b), 0);
  const payments: Record<string, number> = {};
  for (const b of list) for (const [k, v] of Object.entries(b.payments)) payments[k] = (payments[k] ?? 0) + v;
  return {
    name: "All branches", salesMinor: sum((b) => b.salesMinor), count: sum((b) => b.count), revenueExTaxMinor: sum((b) => b.revenueExTaxMinor),
    costMinor: sum((b) => b.costMinor), creditMinor: sum((b) => b.creditMinor), payments, nearExpiryMinor: sum((b) => b.nearExpiryMinor),
    expiredMinor: sum((b) => b.expiredMinor), voids: { n: sum((b) => b.voids.n), minor: sum((b) => b.voids.minor) },
    returns: { n: sum((b) => b.returns.n), minor: sum((b) => b.returns.minor) }, discrepancies: sum((b) => b.discrepancies),
  };
}

/** Plain text for WhatsApp/SMS. Short lines, money in the pharmacy currency, chains get a total plus one line per branch. */
export function formatOwnerSummary(d: SummaryData): string {
  const m = (v: number) => money(v, d.currency);
  const chain = d.branches.length > 1;
  const t = chain ? totalOf(d.branches) : d.branches[0];
  const margin = t.revenueExTaxMinor - t.costMinor;
  const pays = Object.entries(t.payments).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${METHOD[k] ?? k} ${m(v)}`).join(", ");
  const lines = [
    `*${d.pharmacy}* · ${d.dayLabel}`,
    `Sales: ${m(t.salesMinor)} (${t.count} sale${t.count === 1 ? "" : "s"})`,
    `Gross margin: ${m(margin)} (${pct(margin, t.revenueExTaxMinor)}%)`,
    ...(pays ? [`Payments: ${pays}`] : []),
    ...(t.creditMinor ? [`Credit given: ${m(t.creditMinor)}`] : []),
    `Near expiry (90 days): ${m(t.nearExpiryMinor)}`,
    ...(t.expiredMinor ? [`Expired on shelf: ${m(t.expiredMinor)} – remove it`] : []),
    ...(t.voids.n || t.returns.n ? [`Voids: ${t.voids.n} (${m(t.voids.minor)}) · Returns: ${t.returns.n} (${m(t.returns.minor)})`] : []),
    ...(t.discrepancies ? [`Stock discrepancies: ${t.discrepancies} to check`] : []),
  ];
  if (chain) {
    lines.push("", "*By branch*");
    for (const b of d.branches) lines.push(`${b.name}: ${m(b.salesMinor)} · ${b.count} sales · margin ${pct(b.revenueExTaxMinor - b.costMinor, b.revenueExTaxMinor)}%`);
  }
  if (d.reorder.length) {
    lines.push("", "*Reorder*");
    for (const r of d.reorder.slice(0, 5)) lines.push(`- ${r.name}: ${r.packs} × ${r.unit}${r.branch ? ` (${r.branch})` : ""}`);
  }
  return lines.join("\n");
}

type R = Record<string, unknown>;
const rows = async <T extends R>(t: Tx, q: ReturnType<typeof sql>) => (await t.execute(q)) as unknown as T[];

/** Reads one local day's figures for every active branch. Runs inside withTenant. */
export async function gatherSummary(t: Tx, tenant: Pick<Tenant, "id" | "name" | "timezone" | "currency" | "reorderCoverDays">, day: string): Promise<SummaryData> {
  const tz = tenant.timezone;
  const { start, end } = dayRange(day, tz);
  const [s, e] = [start.toISOString(), end.toISOString()];
  const near = addDays(day, 90);
  const brs = await t.select({ id: branches.id, name: branches.name }).from(branches).where(and(eq(branches.tenantId, tenant.id), eq(branches.active, true))).orderBy(asc(branches.name));
  const sale = await rows<{ b: string; total: number; n: number; net: number; cost: number; credit: number }>(t, sql`
    select s.branch_id as b, sum(s.total_minor)::int as total, count(*)::int as n, sum(s.total_minor - s.tax_minor)::int as net, sum(s.cost_minor)::int as cost, sum(s.credit_minor)::int as credit
    from sales s where s.status <> 'voided' and s.sold_at >= ${s} and s.sold_at < ${e} group by 1`);
  const pay = await rows<{ b: string; method: string; amount: number }>(t, sql`
    select branch_id as b, method::text as method, sum(amount_minor)::int as amount from payments
    where status = 'succeeded' and amount_minor > 0 and received_at >= ${s} and received_at < ${e} group by 1, 2`);
  const stock = await rows<{ b: string; near: number; expired: number }>(t, sql`
    select branch_id as b,
      coalesce(sum(qty_on_hand * unit_cost_minor) filter (where expiry >= ${day} and expiry <= ${near}), 0)::bigint as near,
      coalesce(sum(qty_on_hand * unit_cost_minor) filter (where expiry < ${day}), 0)::bigint as expired
    from stock_batches where qty_on_hand > 0 and expiry is not null group by 1`);
  const voids = await rows<{ b: string; n: number; amount: number }>(t, sql`
    select branch_id as b, count(*)::int as n, sum(total_minor)::int as amount from sales where status = 'voided' and sold_at >= ${s} and sold_at < ${e} group by 1`);
  const rets = await rows<{ b: string; n: number; amount: number }>(t, sql`
    select branch_id as b, count(*)::int as n, sum(refund_minor)::int as amount from sale_returns where created_at >= ${s} and created_at < ${e} group by 1`);
  const disc = await rows<{ b: string; n: number }>(t, sql`
    select branch_id as b, count(*)::int as n from alerts where kind = 'stock_discrepancy' and status = 'open' group by 1`);

  const list: BranchDay[] = brs.map((br) => {
    const x = sale.find((r) => r.b === br.id);
    const st = stock.find((r) => r.b === br.id);
    return {
      name: br.name, salesMinor: x?.total ?? 0, count: x?.n ?? 0, revenueExTaxMinor: x?.net ?? 0, costMinor: x?.cost ?? 0, creditMinor: x?.credit ?? 0,
      payments: Object.fromEntries(pay.filter((p) => p.b === br.id).map((p) => [p.method, p.amount])),
      nearExpiryMinor: Number(st?.near ?? 0), expiredMinor: Number(st?.expired ?? 0),
      voids: { n: voids.find((r) => r.b === br.id)?.n ?? 0, minor: voids.find((r) => r.b === br.id)?.amount ?? 0 },
      returns: { n: rets.find((r) => r.b === br.id)?.n ?? 0, minor: rets.find((r) => r.b === br.id)?.amount ?? 0 },
      discrepancies: disc.find((r) => r.b === br.id)?.n ?? 0,
    };
  });
  const reorder: (SummaryData["reorder"][number] & { cover: number })[] = [];
  for (const br of brs) {
    const sug = await reorderSuggestions(t, { tenant: { id: tenant.id, timezone: tz, reorderCoverDays: tenant.reorderCoverDays }, branchId: br.id });
    for (const r of sug.slice(0, 5)) reorder.push({ name: `${r.name}${r.strength ? ` ${r.strength}` : ""}`, branch: brs.length > 1 ? br.name : undefined, packs: r.packs, unit: r.unitName, cover: r.daysOfCover ?? -1 });
  }
  reorder.sort((a, b) => a.cover - b.cover); // most urgent (out of stock = -1) first
  return { pharmacy: tenant.name, dayLabel: dateOnly(`${day}T12:00:00Z`, tz), currency: tenant.currency, branches: list, reorder: reorder.slice(0, 5).map(({ cover: _, ...r }) => r) };
}

/** Builds and queues the summary for `day`. Deduped per tenant per day. Returns the message log id, or null when skipped. */
export async function sendOwnerSummary(t: Tx, tenant: Tenant, day: string) {
  let to = e164(tenant.ownerSummaryTo, tenant.country);
  if (!to) {
    const [owner] = await t.select({ phone: users.phone }).from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.role, "owner"), eq(users.active, true), gt(sql`length(coalesce(${users.phone}, ''))`, 0)))
      .orderBy(asc(users.createdAt)).limit(1);
    to = e164(owner?.phone, tenant.country);
  }
  if (!to) return null;
  const body = formatOwnerSummary(await gatherSummary(t, tenant, day));
  return queueDirectMessage(t, { tenantId: tenant.id, to, channel: "whatsapp", templateKey: "owner_summary", purpose: "operations", vars: { body }, dedupeKey: `ownersum:${tenant.id}:${day}` });
}
