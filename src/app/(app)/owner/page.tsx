import {
  AlertTriangle, Banknote, Boxes, CalendarClock, CreditCard, FileText, Gem, HandCoins, Percent, Pill, Receipt, Scale, ShoppingBasket,
  Store, TrendingUp, Undo2, Wallet, WifiOff,
} from "lucide-react";
import { A, Badge, BarChart, Kpi, LinkButton, Panel, Progress } from "@/components/ui";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateOnly, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { PLANS } from "@/lib/plans";
import { pct } from "../reports/range";
import { limitsFor } from "../settings/limits";
import { delta, deltaPts, monthLabel, pickBranch, resolvePeriod } from "./lib";
import { overview, usage } from "./queries";
import { ConsoleHeader, ShareList } from "./ui";

export const metadata = { title: "Owner console" };
const STATUS_TONE = { trialing: "blue", active: "green", past_due: "yellow", read_only: "red", cancelled: "gray" } as const;

export default async function OwnerConsolePage({ searchParams }: PageProps<"/owner">) {
  const ctx = await requireCtx("admin.console");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const fmt = (v: number) => money(v, cur);
  const period = resolvePeriod(sp.period, tz);
  const branch = pickBranch(sp.branch, ctx.branches.map((b) => b.id));
  const branchIds = branch ? [branch] : ctx.branches.map((b) => b.id);

  const { d, u } = await tx(ctx, async (t) => {
    await audit(t, ctx, "view", "owner_console", null, { details: { page: "overview", period: period.key, branch } });
    return { d: await overview(t, ctx, { branchIds, period }), u: await usage(t, ctx) };
  });

  const { sales: s, months } = d;
  const vs = period.vs;
  const revenue = s.revenue - d.refunds.cur, prevRevenue = s.prevRevenue - d.refunds.prev;
  const margin = s.revenue - s.cost, prevMargin = s.prevRevenue - s.prevCost;
  const marginPct = pct(margin, s.revenue), prevMarginPct = pct(prevMargin, s.prevRevenue);
  const basket = s.n ? Math.round(s.revenue / s.n) : 0, prevBasket = s.prevN ? Math.round(s.prevRevenue / s.prevN) : 0;
  const net = margin - d.refunds.cur - d.expenses.cur, prevNet = prevMargin - d.refunds.prev - d.expenses.prev;
  const t = ctx.tenant;
  const plan = PLANS[t.plan];
  const limits = limitsFor(t);
  const branchName = branch ? ctx.branches.find((b) => b.id === branch)?.name : "All branches";

  return (
    <>
      <ConsoleHeader ctx={ctx} current="overview" period={period.key} branch={branch}
        subtitle={`${branchName} · ${dateOnly(period.start, tz)} – ${dateOnly(new Date(period.end.getTime() - 1), tz)} · how the pharmacy is doing`} />

      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Sales">
          <Kpi label="Sales" value={fmt(revenue)} icon={<Banknote />} tone="purple" trend={months.revenue} href="/reports"
            delta={delta(revenue, prevRevenue, vs)} sub={d.refunds.cur ? `after ${fmt(d.refunds.cur)} refunded` : !prevRevenue ? "no earlier data" : undefined} />
          <Kpi label="Gross margin" value={fmt(margin)} icon={<Percent />} tone={marginPct >= 20 ? "green" : "yellow"} trend={months.margin}
            delta={deltaPts(marginPct, prevMarginPct, vs)} sub={`${marginPct}% of sales, at FEFO batch cost`} />
          <Kpi label="Customers served" value={s.n.toLocaleString("en")} icon={<ShoppingBasket />} tone="blue"
            delta={delta(s.n, s.prevN, vs)} sub={`${(s.n / period.days).toFixed(1)} sales a day`} />
          <Kpi label="Average basket" value={fmt(basket)} icon={<Receipt />} tone="teal" delta={delta(basket, prevBasket, vs)} />
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Stock and money">
          <Kpi label="Stock value" value={fmt(d.stock.value)} icon={<Boxes />} tone="blue" href="/stock" sub="at cost · today" />
          <Kpi label="Expiring in 90 days" value={fmt(d.stock.expiring)} icon={<CalendarClock />} tone={d.stock.expiring ? "yellow" : "green"} href="/alerts"
            sub={d.stock.expired ? `${fmt(d.stock.expired)} already expired` : "act now: discount, transfer or return"} />
          <Kpi label="Customers owe" value={fmt(d.credit.owed)} icon={<Wallet />} tone="yellow" href="/customers" sub={`${d.credit.debtors} accounts · ${fmt(s.credit)} given on credit this period`} />
          <Kpi label="Net after expenses" value={fmt(net)} icon={<Scale />} tone={net >= 0 ? "green" : "red"} trend={months.labels.map((_, i) => months.margin[i] - months.expenses[i])}
            delta={prevNet > 0 ? delta(net, prevNet, vs) : undefined} sub={`margin − refunds − ${fmt(d.expenses.cur)} expenses`} />
        </section>

        <section className="grid gap-4 xl:grid-cols-12">
          <Panel className="xl:col-span-8" title="Sales and margin" eyebrow="Last 12 months" icon={<TrendingUp />}
            actions={<LinkButton href="/reports" variant="ghost" size="sm">Reports</LinkButton>}>
            <BarChart data={months.labels.map((l, i) => ({ label: monthLabel(l), value: months.revenue[i] }))} format={fmt} height={200} />
            <p className="mt-3 text-xs text-subtle">Margin this period {fmt(margin)} on {fmt(s.revenue)} sold. Discounts given: {fmt(s.discounts)}{s.prevDiscounts ? ` (was ${fmt(s.prevDiscounts)})` : ""}.</p>
          </Panel>

          <Panel className="xl:col-span-4" title={`${plan.name} plan`} eyebrow="Subscription & usage" icon={<Gem />}
            actions={<Badge tone={STATUS_TONE[t.planStatus]}>{t.planStatus.replace("_", " ")}</Badge>}>
            <p className="mb-4 text-sm text-muted">
              {t.planStatus === "trialing" && t.trialEndsAt ? `Trial ends ${dateOnly(t.trialEndsAt, tz)} — every feature is on until then`
                : t.currentPeriodEnd ? `${t.planStatus === "cancelled" ? "Ended" : "Renews"} ${dateOnly(t.currentPeriodEnd, tz)} · ${t.billingCycle}` : "No billing period yet"}
            </p>
            <ul className="space-y-3">
              {([["Staff accounts", u.users, limits.users], ["Branches", u.branches, limits.branches]] as const).map(([label, used, limit]) => (
                <li key={label}>
                  <div className="flex justify-between text-sm"><span className="text-muted">{label}</span>
                    <span className="tabular-nums text-fg">{used} <span className="text-subtle">/ {limit ?? "unlimited"}</span></span></div>
                  {limit !== null && <Progress value={(used / limit) * 100} tone={used >= limit ? "red" : used / limit >= 0.8 ? "yellow" : "purple"} className="mt-1.5" />}
                </li>
              ))}
            </ul>
            {t.plan === "chain" && <p className="mt-3 text-xs text-subtle">Billed for {t.billedBranches} branches.</p>}
            {can(ctx.user.role, "subscription.manage")
              ? <LinkButton href="/settings/subscription" variant="secondary" size="sm" className="mt-5 w-full">Manage plan</LinkButton>
              : <p className="mt-5 text-xs text-subtle">Plan changes are made by the pharmacy owner.</p>}
          </Panel>
        </section>

        <section className="grid gap-4 lg:grid-cols-2" aria-label="Mix">
          <Panel title="By payment method" eyebrow="Money taken" icon={<CreditCard />}>
            <ShareList rows={d.mix.methods} format={fmt} empty="No payments in this period" meta={(i) => `${d.mix.methods[i].n} payments`} />
          </Panel>
          <Panel title="Top products" eyebrow="By sales" icon={<Pill />} actions={<A href="/reports" className="text-xs">All products</A>}>
            <ShareList rows={d.mix.products} format={fmt} tone="teal" empty="No sales in this period"
              meta={(i) => `${d.mix.products[i].qty.toLocaleString("en")} units · ${pct(d.mix.products[i].margin, d.mix.products[i].amount)}% margin`} />
          </Panel>
          {d.mix.branches.length > 1 && (
            <Panel title="By branch" eyebrow="Sales" icon={<Store />}>
              <ShareList rows={d.mix.branches} format={fmt} tone="blue" empty="No sales in this period" meta={(i) => `${d.mix.branches[i].n} sales`} />
            </Panel>
          )}
          <Panel title="Watch list" eyebrow={period.label} icon={<AlertTriangle />} actions={<A href="/owner/team" className="text-xs">Staff accountability</A>}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Mini icon={<Undo2 />} label="Refunded" value={fmt(d.refunds.cur)} sub={`${d.refunds.voids} sales voided`} bad={d.refunds.cur > s.revenue * 0.03} />
              <Mini icon={<HandCoins />} label="Discounts" value={fmt(s.discounts)} sub={`${pct(s.discounts, s.revenue + s.discounts)}% of list price`} />
              <Mini icon={<Boxes />} label="Expired at cost" value={fmt(d.stock.expired)} sub="still on the shelf" bad={d.stock.expired > 0} />
              <Mini icon={<AlertTriangle />} label="Open alerts" value={d.alerts.open} sub={`${d.alerts.lowStock} low or out of stock`} />
              <Mini icon={<WifiOff />} label="Offline sales" value={s.offline} sub="synced when back online" />
              <Mini icon={<Boxes />} label="Quarantined" value={fmt(d.stock.quarantined)} sub="recalled or held" bad={d.stock.quarantined > 0} />
            </div>
          </Panel>
        </section>

        <p className="flex items-center gap-2 text-xs text-subtle"><FileText className="h-3.5 w-3.5" aria-hidden />
          Sales exclude voided sales; refunds on returns are taken off. Margin uses the cost of the exact batches sold (FEFO). Stock figures are for today.
        </p>
      </div>
    </>
  );
}

function Mini({ icon, label, value, sub, bad }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; bad?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}{label}</div>
      <div className={bad ? "mt-1.5 text-xl font-semibold tabular-nums text-bad" : "mt-1.5 text-xl font-semibold tabular-nums text-fg"}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}
