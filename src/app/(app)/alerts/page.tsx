import { and, asc, desc, eq, sql } from "drizzle-orm";
import { AlarmClock, BellRing, CircleSlash, PackageX, ShieldAlert, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { A, Badge, Callout, EmptyState, Field, Input, Kpi, LinkButton, PageHeader, Panel, Select, type Tone } from "@/components/ui";
import { alerts, customers, products, stockBatches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { sqlToday } from "@/lib/catalog";
import { dateOnly, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { quarantineAlertAction, resolveAlertAction, writeOffAlertAction } from "./actions";
import { RESOLUTIONS } from "./logic";

export const metadata = { title: "Alerts" };

type Kind = (typeof alerts.$inferSelect)["kind"];
/** Most urgent first. */
const KINDS: { kind: Kind; label: string; tone: Tone; icon: ReactNode }[] = [
  { kind: "recall", label: "Recalls", tone: "red", icon: <ShieldAlert /> },
  { kind: "sale_review", label: "Offline sales to review", tone: "red", icon: <ShieldAlert /> },
  { kind: "expired", label: "Expired", tone: "red", icon: <CircleSlash /> },
  { kind: "out_of_stock", label: "Out of stock", tone: "red", icon: <PackageX /> },
  { kind: "stock_discrepancy", label: "Stock discrepancies", tone: "yellow", icon: <PackageX /> },
  { kind: "expiry_30", label: "Expiring within 30 days", tone: "red", icon: <AlarmClock /> },
  { kind: "return_window", label: "Supplier return window closing", tone: "yellow", icon: <AlarmClock /> },
  { kind: "expiry_60", label: "Expiring within 60 days", tone: "yellow", icon: <AlarmClock /> },
  { kind: "low_stock", label: "Low stock", tone: "yellow", icon: <PackageX /> },
  { kind: "expiry_90", label: "Expiring within 90 days", tone: "blue", icon: <AlarmClock /> },
  { kind: "refill_due", label: "Refills due", tone: "teal", icon: <Users /> },
];
const RES_LABEL: Record<(typeof RESOLUTIONS)[number], string> = {
  discounted: "Discounted", transferred: "Transferred", returned: "Returned to supplier", written_off: "Written off", ordered: "Ordered", dismissed: "Not needed",
};
const EXPIRY = new Set<Kind>(["expiry_30", "expiry_60", "expiry_90", "expired", "recall", "return_window"]);

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const want = (await searchParams).kind;
  const ctx = await requireCtx("stock.view");
  const role = ctx.user.role, cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const canResolve = can(role, "stock.take"), canAdjust = can(role, "stock.adjust"), canTransfer = can(role, "stock.transfer") && hasFeature(ctx.tenant, "transfers");
  const { rows, kpi } = await tx(ctx, async (t) => {
    const rows = await t.select({
      a: alerts, productName: products.name, strength: products.strength, schedule: products.schedule, baseUnit: products.baseUnit,
      batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, qty: stockBatches.qtyOnHand, quarantined: stockBatches.quarantined, customerName: customers.name,
    }).from(alerts).leftJoin(products, eq(products.id, alerts.productId)).leftJoin(stockBatches, eq(stockBatches.id, alerts.batchId)).leftJoin(customers, eq(customers.id, alerts.customerId))
      .where(and(eq(alerts.branchId, ctx.branchId), eq(alerts.status, "open")))
      .orderBy(sql`${alerts.dueOn} asc nulls last`, desc(alerts.valueMinor), asc(alerts.createdAt)).limit(1000);
    // Live figures from the batches, so the strip is right even between nightly alert runs.
    const [k] = await t.select({
      near: sql<number>`coalesce(sum(${stockBatches.qtyOnHand} * ${stockBatches.unitCostMinor}) filter (where ${stockBatches.expiry} >= ${sqlToday} and ${stockBatches.expiry} <= ${sqlToday} + 90), 0)::float`,
      expired: sql<number>`coalesce(sum(${stockBatches.qtyOnHand} * ${stockBatches.unitCostMinor}) filter (where ${stockBatches.expiry} < ${sqlToday}), 0)::float`,
    }).from(stockBatches).where(and(eq(stockBatches.branchId, ctx.branchId), sql`${stockBatches.qtyOnHand} > 0`));
    return { rows, kpi: k };
  });
  const out = rows.filter((r) => r.a.kind === "out_of_stock").length;
  const groups = KINDS.map((k) => ({ ...k, items: rows.filter((r) => r.a.kind === k.kind) })).filter((g) => g.items.length && (!want || want === g.kind));

  return (
    <>
      <PageHeader title="Alerts" eyebrow="Today" icon={<BellRing />} subtitle={rows.length ? `${rows.length} things need a look at this branch` : "Nothing needs attention at this branch"} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Expiring in 90 days" value={money(Math.round(kpi.near), cur)} sub="stock value at cost" tone="yellow" icon={<AlarmClock />} />
        <Kpi label="Expired on the shelf" value={money(Math.round(kpi.expired), cur)} sub="write off or return" tone="red" icon={<CircleSlash />} />
        <Kpi label="Out of stock" value={out} sub={out === 1 ? "item" : "items"} tone="red" icon={<PackageX />} />
      </div>

      {!groups.length && <EmptyState icon={<BellRing />} title="All clear">Expiry, stock and recall alerts show up here after each nightly check.</EmptyState>}
      <div className="space-y-6">
        {groups.map((g) => (
          <Panel key={g.kind} icon={g.icon} title={g.label} eyebrow={`${g.items.length} open · ${money(g.items.reduce((s, r) => s + r.a.valueMinor, 0), cur)} at risk`} bodyClassName="p-3">
            <ul className="divide-y divide-line">
              {g.items.map((r) => {
                const a = r.a;
                const controlled = r.schedule === "controlled";
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-2 py-3">
                    <div className="min-w-0 flex-1 basis-64">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">{a.title}</span>
                        <Badge tone={g.tone}>{g.label.split(" ")[0]}</Badge>
                        {r.quarantined && <Badge tone="purple">Quarantined</Badge>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {[r.productName && [r.productName, r.strength].filter(Boolean).join(" "), r.batchNo && `Batch ${r.batchNo}`, r.expiry && `Expires ${dateOnly(r.expiry, tz)}`,
                          r.qty != null && `${r.qty} ${r.baseUnit} left`, r.customerName, a.detail].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {a.valueMinor > 0 && <span className="text-sm font-semibold tabular-nums text-fg">{money(a.valueMinor, cur)}</span>}
                    {a.dueOn && <span className="text-xs text-subtle">by {dateOnly(a.dueOn, tz)}</span>}
                    <div className="flex flex-wrap items-center gap-2">
                      {(a.kind === "expiry_30" || a.kind === "expiry_60" || a.kind === "expiry_90") && a.productId && can(role, "prices.write") && <>
                        <LinkButton size="sm" variant="secondary" href={`/products/${a.productId}/edit`}>Set a new price</LinkButton>
                        {canResolve && <ActionButton action={resolveAlertAction} fields={{ id: a.id, resolution: "discounted" }}>Mark discounted</ActionButton>}
                      </>}
                      {EXPIRY.has(a.kind) && a.kind !== "expired" && a.kind !== "recall" && a.batchId && canTransfer && <LinkButton size="sm" variant="secondary" href={`/transfers/new?batch=${a.batchId}`}>Transfer</LinkButton>}
                      {EXPIRY.has(a.kind) && a.batchId && <LinkButton size="sm" variant="secondary" href={`/returns/new?batch=${a.batchId}`}>Return to supplier</LinkButton>}
                      {a.kind === "recall" && a.batchId && !r.quarantined && canAdjust && <ActionButton action={quarantineAlertAction} fields={{ id: a.id }}>Quarantine batch</ActionButton>}
                      {(a.kind === "low_stock" || a.kind === "out_of_stock") && can(role, "purchasing.manage") && <LinkButton size="sm" variant="secondary" href="/purchasing/reorder">Reorder</LinkButton>}
                      {(a.kind === "low_stock" || a.kind === "out_of_stock" || a.kind === "stock_discrepancy") && a.productId && canResolve && <LinkButton size="sm" variant="secondary" href={`/stock/take?product=${a.productId}`}>Count now</LinkButton>}
                      {a.kind === "refill_due" && a.customerId && <LinkButton size="sm" variant="secondary" href={`/customers/${a.customerId}`}>Open customer</LinkButton>}
                      {canResolve && <ActionButton action={resolveAlertAction} fields={{ id: a.id, resolution: "dismissed" }} variant="ghost">Dismiss</ActionButton>}
                    </div>
                    {(canResolve || (EXPIRY.has(a.kind) && a.batchId && canAdjust)) && (
                      <details className="basis-full">
                        <summary className="cursor-pointer list-none text-xs font-medium text-accent hover:underline [&::-webkit-details-marker]:hidden">More: close or write off</summary>
                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                          {canResolve && (
                            <ActionForm action={resolveAlertAction} className="rounded-md border border-line bg-surface p-4">
                              <input type="hidden" name="id" value={a.id} />
                              <Field label="What did you do?">
                                <Select name="resolution" defaultValue="">
                                  <option value="" disabled>Choose</option>
                                  {RESOLUTIONS.map((x) => <option key={x} value={x}>{RES_LABEL[x]}</option>)}
                                </Select>
                              </Field>
                              <Submit variant="secondary" size="sm">Close alert</Submit>
                            </ActionForm>
                          )}
                          {EXPIRY.has(a.kind) && a.batchId && canAdjust && (!controlled || can(role, "controlled.destroy")) && (
                            <ActionForm action={writeOffAlertAction} className="rounded-md border border-bad/30 bg-bad/5 p-4">
                              <input type="hidden" name="id" value={a.id} />
                              <p className="text-sm text-muted">Remove all {r.qty ?? 0} {r.baseUnit} of this batch from stock as expired.</p>
                              {controlled && <Field label="Witness name" hint="Controlled drug: the witness is recorded in the register."><Input name="witnessName" required /></Field>}
                              <Submit variant="danger" size="sm">Write off</Submit>
                            </ActionForm>
                          )}
                        </div>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))}
      </div>
      {rows.length >= 1000 && <div className="mt-6"><Callout tone="yellow">Showing the first 1,000 alerts. Clear some to see the rest.</Callout></div>}
      <p className="mt-6 text-xs text-subtle">Expiry values are at cost. <A href="/stock">See all stock</A></p>
    </>
  );
}
