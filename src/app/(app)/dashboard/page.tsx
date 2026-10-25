import { sql, type SQL } from "drizzle-orm";
import {
  AlertTriangle, BadgeCheck, BellRing, Bike, Boxes, CalendarX, Coins, HandCoins, PackageX, Receipt, ScanLine, ShoppingBasket, ShoppingCart, TrendingUp, Wallet,
} from "lucide-react";
import Link from "next/link";
import { A, Badge, BarChart, cx, EmptyState, Kpi, LinkButton, ListRow, PageHeader, Panel, type Tone } from "@/components/ui";
import type { Tx } from "@/db";
import { branchScope, pct } from "@/lib/analytics";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, dayRange, localDay, money, timeOnly } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { reorderSuggestions } from "@/lib/reorder";
import { denseSeries } from "../reports/range";
import { BranchPicker } from "../reports/ui";

export const metadata = { title: "Dashboard" };

type R = Record<string, string | number | null>;
const q = async <T extends R = R>(t: Tx, s: SQL) => (await t.execute(s)) as unknown as T[];
const one = async <T extends R = R>(t: Tx, s: SQL) => (await q<T>(t, s))[0];

const ALERT_LABEL: Record<string, [string, Tone]> = {
  expired: ["Expired", "red"], expiry_30: ["Expiring ≤30 days", "red"], expiry_60: ["Expiring ≤60 days", "yellow"], expiry_90: ["Expiring ≤90 days", "yellow"],
  out_of_stock: ["Out of stock", "red"], low_stock: ["Running low", "yellow"], recall: ["Recalls", "red"], return_window: ["Return windows closing", "blue"],
  stock_discrepancy: ["Stock discrepancies", "purple"], refill_due: ["Refills due", "teal"], sale_review: ["Offline sales to review", "red"],
};

/** Same time of day, one week back: today's elapsed time added to last week's start. */
const sameTimeLastWeek = (lastWeekStart: Date, todayStart: Date) => new Date(lastWeekStart.getTime() + (Date.now() - todayStart.getTime())).toISOString();

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const role = ctx.user.role;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const m = (v: number | string | null | undefined) => money(Number(v ?? 0), cur);
  const sees = {
    money: can(role, "reports.view"), margin: can(role, "reports.margin"), stock: can(role, "stock.view"), sell: can(role, "pos.sell"),
    reorder: can(role, "purchasing.manage"), cashup: can(role, "cashup"), credit: can(role, "customers.read"),
    deliveries: can(role, "deliveries.manage") && hasFeature(ctx.tenant, "delivery"), claims: can(role, "claims.manage") && hasFeature(ctx.tenant, "claims"),
  };
  const scope = branchScope({ role, consolidated: hasFeature(ctx.tenant, "consolidated"), branches: ctx.branches, current: ctx.branchId, wanted: typeof sp.branch === "string" ? sp.branch : null });
  const B = scope.ids;
  const today = localDay(tz);
  const r = dayRange(today, tz), lw = dayRange(addDays(today, -7), tz);
  const [start, end] = [r.start.toISOString(), r.end.toISOString()];
  const lastWeekEnd = sameTimeLastWeek(lw.start, r.start);
  const from14 = addDays(today, -13), start14 = dayRange(from14, tz).start.toISOString();
  const near = addDays(today, 90);

  const d = await tx(ctx, async (t) => {
    const salesToday = await one<{ total: number; n: number; net: number; cost: number }>(t, sql`select coalesce(sum(total_minor), 0)::int as total, count(*)::int as n,
        coalesce(sum(total_minor - tax_minor), 0)::int as net, coalesce(sum(cost_minor), 0)::int as cost
      from sales where status <> 'voided' and branch_id in ${B} and sold_at >= ${start} and sold_at < ${end}`);
    const lastWeek = await one<{ total: number; n: number }>(t, sql`select coalesce(sum(total_minor), 0)::int as total, count(*)::int as n
      from sales where status <> 'voided' and branch_id in ${B} and sold_at >= ${lw.start.toISOString()} and sold_at < ${lastWeekEnd}`);
    const series = sees.money ? await q<{ day: string; amount: number }>(t, sql`select (sold_at at time zone ${tz})::date::text as day, sum(total_minor)::int as amount
      from sales where status <> 'voided' and branch_id in ${B} and sold_at >= ${start14} and sold_at < ${end} group by 1`) : [];
    const stock = sees.stock ? await one<{ value: number; near: number; expired: number }>(t, sql`select
        coalesce(round(sum(qty_on_hand * unit_cost_minor)), 0)::float8 as value,
        coalesce(round(sum(qty_on_hand * unit_cost_minor) filter (where expiry >= ${today} and expiry <= ${near})), 0)::float8 as near,
        coalesce(round(sum(qty_on_hand * unit_cost_minor) filter (where expiry < ${today})), 0)::float8 as expired
      from stock_batches where qty_on_hand > 0 and branch_id in ${B}`) : null;
    const alertsByKind = sees.stock || sees.sell ? await q<{ kind: string; n: number; value: number }>(t, sql`select kind::text as kind, count(*)::int as n, coalesce(sum(value_minor), 0)::int as value
      from alerts where status = 'open' and branch_id in ${B} group by 1 order by 2 desc`) : [];
    const reorder = sees.stock ? (await Promise.all(B.map((branchId) => reorderSuggestions(t, { tenant: ctx.tenant, branchId })))).flat() : [];
    const top = sees.money ? await q<{ product: string; units: number; revenue: number }>(t, sql`select p.name || coalesce(' ' || p.strength, '') as product,
        sum(sl.base_qty - sl.returned_base_qty)::int as units, sum(sl.total_minor)::int as revenue
      from sale_lines sl join sales s on s.id = sl.sale_id join products p on p.id = sl.product_id
      where s.status <> 'voided' and s.branch_id in ${B} and s.sold_at >= ${dayRange(addDays(today, -6), tz).start.toISOString()} and s.sold_at < ${end}
      group by p.id, p.name, p.strength order by 3 desc limit 6`) : [];
    const recent = sees.sell ? await q<{ id: string; saleNo: string; total: number; soldAt: string; status: string; customer: string | null; cashier: string | null }>(t, sql`
      select s.id, s.sale_no as "saleNo", s.total_minor as total, s.sold_at as "soldAt", s.status::text as status, c.name as customer, u.name as cashier
      from sales s left join customers c on c.id = s.customer_id left join users u on u.id = s.cashier_id
      where s.branch_id in ${B} order by s.sold_at desc limit 8`) : [];
    const cash = sees.cashup ? await one<{ cash: number; momo: number; expenses: number }>(t, sql`select
        (select coalesce(sum(amount_minor), 0) from payments where status = 'succeeded' and method = 'cash' and branch_id in ${B} and received_at >= ${start} and received_at < ${end})::int as cash,
        (select coalesce(sum(amount_minor), 0) from payments where status = 'succeeded' and method = 'mobile_money' and branch_id in ${B} and received_at >= ${start} and received_at < ${end})::int as momo,
        (select coalesce(sum(amount_minor), 0) from expenses where method = 'cash' and branch_id in ${B} and day = ${today})::int as expenses`) : null;
    const credit = sees.credit && sees.money ? await one<{ total: number; n: number }>(t, sql`select coalesce(sum(balance_minor), 0)::int as total, count(*)::int as n
      from customers where balance_minor > 0 and deleted_at is null`) : null;
    const deliveries = sees.deliveries ? await one<{ pending: number; out: number }>(t, sql`select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'out')::int as out
      from deliveries where branch_id in ${B} and status in ('pending', 'out')`) : null;
    const claims = sees.claims ? await one<{ draft: number; open: number; owed: number }>(t, sql`select count(*) filter (where status = 'draft')::int as draft,
        count(*) filter (where status in ('submitted', 'partially_paid'))::int as open,
        coalesce(sum(total_claimed_minor - total_paid_minor) filter (where status in ('submitted', 'partially_paid')), 0)::int as owed from claims`) : null;
    return { salesToday, lastWeek, series, stock, alertsByKind, reorder, top, recent, cash, credit, deliveries, claims };
  });

  const s = d.salesToday;
  const basket = s.n ? Math.round(s.total / s.n) : 0, lastBasket = d.lastWeek.n ? Math.round(d.lastWeek.total / d.lastWeek.n) : 0;
  const delta = (now: number, before: number, good = true) => before ? { value: `${now >= before ? "+" : ""}${pct(now - before, before)}% vs last week`, good: (now >= before) === good } : undefined;
  const trend = denseSeries(from14, today, new Map(d.series.map((x) => [x.day, Number(x.amount)]))).map((x) => x.value);
  const oos = d.reorder.filter((x) => x.reason === "out_of_stock").length;
  const openAlerts = d.alertsByKind.reduce((a, k) => a + k.n, 0);
  const branchName = scope.all ? "All branches" : ctx.branches.find((b) => b.id === B[0])?.name;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(new Date()));

  return (
    <>
      <PageHeader eyebrow={`${branchName ?? ctx.tenant.name} · ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date())}`}
        title={`Good ${hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening"}, ${ctx.user.name.split(" ")[0]}`}
        subtitle={openAlerts ? `${openAlerts} open alert${openAlerts === 1 ? "" : "s"} need${openAlerts === 1 ? "s" : ""} a look.` : "No open alerts. Nice and calm."}
        actions={sees.sell && ctx.access === "full" ? <LinkButton href="/pos"><ScanLine className="h-4 w-4" aria-hidden />Open the till</LinkButton> : undefined} />
      <BranchPicker branches={ctx.branches} scope={scope} path="/dashboard" keep={{}} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(sees.money || sees.sell) && <Kpi label="Sales today" value={m(s.total)} icon={<Receipt />} tone="green" trend={sees.money ? trend : undefined} delta={delta(s.total, d.lastWeek.total)} sub={sees.money ? "14-day trend" : undefined} href={sees.money ? "/reports/sales-day?preset=last30" : "/sales"} />}
        {(sees.money || sees.sell) && <Kpi label="Transactions" value={s.n.toLocaleString("en")} icon={<ShoppingBasket />} tone="blue" delta={delta(s.n, d.lastWeek.n)} sub={`avg basket ${m(basket)}`} />}
        {sees.margin && <Kpi label="Gross margin" value={m(s.net - s.cost)} icon={<TrendingUp />} tone="purple" sub={`${pct(s.net - s.cost, s.net)}% of sales ex tax`} href="/reports/margin-product?preset=today" />}
        {sees.money && !sees.margin && <Kpi label="Average basket" value={m(basket)} icon={<Coins />} tone="purple" delta={delta(basket, lastBasket)} />}
        {sees.cashup && d.cash && <Kpi label="Cash expected" value={m(d.cash.cash - d.cash.expenses)} icon={<Wallet />} tone="teal" sub={`MoMo ${m(d.cash.momo)} · do the close`} href="/cashup" />}
      </div>

      {sees.stock && d.stock && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Expiring in 90 days" value={m(d.stock.near)} icon={<CalendarX />} tone={d.stock.near ? "yellow" : "green"} sub="at cost · act before it's lost" href="/alerts" />
          <Kpi label="Expired on shelf" value={m(d.stock.expired)} icon={<AlertTriangle />} tone={d.stock.expired ? "red" : "green"} sub={d.stock.expired ? "remove and write off" : "nothing expired"} href="/alerts" />
          <Kpi label="To reorder" value={d.reorder.length.toLocaleString("en")} icon={<ShoppingCart />} tone={oos ? "red" : "blue"} sub={`${oos} out of stock`} href={sees.reorder ? "/purchasing/reorder" : "/stock"} />
          {sees.margin ? <Kpi label="Stock value" value={m(d.stock.value)} icon={<Boxes />} tone="gray" sub="at cost" href="/reports/valuation" />
            : <Kpi label="Out of stock" value={oos.toLocaleString("en")} icon={<PackageX />} tone={oos ? "red" : "green"} href="/stock" />}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {sees.money && (
          <Panel className="lg:col-span-8" icon={<TrendingUp />} eyebrow="Last 14 days" title="Takings" actions={<A href="/reports/sales-day?preset=last30">Report</A>}>
            <BarChart data={denseSeries(from14, today, new Map(d.series.map((x) => [x.day, Number(x.amount)]))).map((x) => ({ label: x.day.slice(8), value: x.value }))} format={(v) => m(v)} />
          </Panel>
        )}
        {(sees.stock || sees.sell) && (
          <Panel className={cx(sees.money ? "lg:col-span-4" : "lg:col-span-6")} icon={<BellRing />} eyebrow="Needs attention" title="Open alerts" actions={<A href="/alerts">All alerts</A>}>
            {d.alertsByKind.length === 0 ? <EmptyState compact title="All clear">The nightly check found nothing to act on.</EmptyState> : (
              <ul className="divide-y divide-line">
                {d.alertsByKind.map((k) => {
                  const [label, tone] = ALERT_LABEL[k.kind] ?? [k.kind, "gray" as Tone];
                  return (
                    <li key={k.kind}>
                      <Link href={`/alerts?kind=${k.kind}`} className="flex items-center justify-between gap-3 py-2.5 text-sm transition hover:text-accent">
                        <span className="flex items-center gap-2"><Badge tone={tone}>{k.n}</Badge>{label}</span>
                        {sees.margin && k.value > 0 && <span className="tabular-nums text-muted">{m(k.value)}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}
        {sees.money && (
          <Panel className="lg:col-span-6" icon={<ShoppingBasket />} eyebrow="Last 7 days" title="Top sellers" actions={<A href="/reports/abc">ABC analysis</A>}>
            {d.top.length === 0 ? <EmptyState compact title="No sales yet this week" /> : (
              <div className="-mx-3 divide-y divide-line">
                {d.top.map((p) => <ListRow key={p.product} title={p.product} meta={`${p.units} units`} trailing={<span className="tabular-nums">{m(p.revenue)}</span>} />)}
              </div>
            )}
          </Panel>
        )}
        {sees.sell && (
          <Panel className="lg:col-span-6" icon={<Receipt />} eyebrow="Counter" title="Recent sales" actions={<A href="/sales">All sales</A>}>
            {d.recent.length === 0 ? <EmptyState compact title="No sales yet">Ring up the first sale on the till.</EmptyState> : (
              <div className="-mx-3 divide-y divide-line">
                {d.recent.map((x) => (
                  <ListRow key={x.id} href={`/sales/${x.id}`} title={<span className="font-mono text-xs text-muted">{x.saleNo}</span>}
                    meta={`${timeOnly(x.soldAt, tz)}${x.customer ? ` · ${x.customer}` : ""}${x.cashier ? ` · ${x.cashier}` : ""}`}
                    trailing={<span className="flex items-center gap-2 tabular-nums">{x.status !== "completed" && <Badge tone={x.status === "voided" ? "red" : "yellow"}>{x.status.replace("_", " ")}</Badge>}{m(x.total)}</span>} />
                ))}
              </div>
            )}
          </Panel>
        )}
        {(d.credit || d.deliveries || d.claims) && (
          <div className="grid gap-4 sm:grid-cols-3 lg:col-span-12">
            {d.credit && <Kpi label="Customer credit owed" value={m(d.credit.total)} icon={<HandCoins />} tone="yellow" sub={`${d.credit.n} customer${d.credit.n === 1 ? "" : "s"}`} href="/reports/credit-aging" />}
            {d.deliveries && <Kpi label="Deliveries" value={(d.deliveries.pending + d.deliveries.out).toLocaleString("en")} icon={<Bike />} tone="blue" sub={`${d.deliveries.pending} to dispatch · ${d.deliveries.out} on the road`} href="/deliveries" />}
            {d.claims && <Kpi label="Insurance claims" value={m(d.claims.owed)} icon={<BadgeCheck />} tone="purple" sub={`${d.claims.open} awaiting payment · ${d.claims.draft} draft`} href="/claims" />}
          </div>
        )}
      </div>
    </>
  );
}
