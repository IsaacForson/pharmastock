import { Activity, AlertTriangle, Building2, CalendarClock, CircleDollarSign, Hourglass, MessageSquare, Trash2, TrendingUp, Users, WifiOff } from "lucide-react";
import Link from "next/link";
import { A, Badge, BarChart, Callout, Kpi, Panel, PageHeader, Progress, Table, Td } from "@/components/ui";
import { money } from "@/lib/format";
import { platformCan, requireAdmin } from "@/lib/platform-auth";
import { deletionRequests, platformOverview, systemHealth } from "@/lib/platform-metrics";
import { controlMoney } from "./money";
import { PLANS, type PlanKey } from "@/lib/plans";

export const metadata = { title: "Overview" };

const STATUS_TONE = { active: "green", trialing: "purple", past_due: "yellow", read_only: "red", cancelled: "gray", suspended: "red" } as const;

export default async function ControlOverview({ searchParams }: PageProps<"/admin">) {
  const { admin } = await requireAdmin();
  const denied = (await searchParams).denied;
  const seeMoney = platformCan(admin.role, "revenue.view");
  const { m, fmt, display } = await controlMoney(admin);
  const [o, health, deletions] = await Promise.all([platformOverview(m), systemHealth(), deletionRequests()]);
  const failed = health.jobs.filter((j) => j.status === "failed").reduce((n, j) => n + j.n, 0);
  const statusTotal = Object.values(o.byStatus).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader eyebrow="PharmaStock Control" icon={<TrendingUp />} title={`Hello, ${admin.name.split(" ")[0]}`} subtitle="The whole business at a glance: pharmacies, revenue, usage and system health." />
      {denied && <div className="mb-4"><Callout tone="yellow" icon={<AlertTriangle />}>Your role doesn&apos;t include that page.</Callout></div>}
      {(failed > 0 || deletions.length > 0 || o.trialsEndingSoon > 0) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {failed > 0 && <Link href="/admin/system" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm hover:border-line-strong"><AlertTriangle className="h-4 w-4 text-bad" />{failed} failed background jobs</Link>}
          {deletions.length > 0 && <Link href="/admin/pharmacies?status=deletion" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm hover:border-line-strong"><Trash2 className="h-4 w-4 text-warn" />{deletions.length} deletion request{deletions.length === 1 ? "" : "s"}</Link>}
          {o.trialsEndingSoon > 0 && <Link href="/admin/pharmacies?status=trialing" className="glass inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm hover:border-line-strong"><Hourglass className="h-4 w-4 text-accent" />{o.trialsEndingSoon} trials end within 3 days</Link>}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {seeMoney ? <Kpi label="MRR" value={fmt(o.mrr)} sub={`ARR ${fmt(o.arr)} · shown in ${display}`} icon={<CircleDollarSign />} tone="purple" href="/admin/revenue" trend={o.collected.map((c) => c.amount)} /> : null}
        <Kpi label="Paying pharmacies" value={o.payingPharmacies} sub={`${o.pharmacies} pharmacies · ${o.activity.branches} branches`} icon={<Building2 />} tone="teal" href="/admin/pharmacies?status=active" />
        <Kpi label="On trial" value={o.byStatus.trialing ?? 0} sub={`${o.trialsEndingSoon} ending in 3 days`} icon={<Hourglass />} tone="blue" href="/admin/pharmacies?status=trialing" />
        <Kpi label="Active this week" value={o.activity.active7} sub={`${o.activity.sales30.toLocaleString()} sales in 30 days`} icon={<Activity />} tone="green" />
        {!seeMoney && <Kpi label="Customers on platform" value={o.activity.customers.toLocaleString()} icon={<Users />} />}
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Panel title="New pharmacy signups" eyebrow="Last 12 weeks" icon={<Building2 />}>
            {o.signups.length ? <BarChart data={o.signups.map((s) => ({ label: s.week.slice(5), value: s.n }))} height={170} /> : <p className="text-sm text-muted">No signups yet.</p>}
          </Panel>
          {seeMoney && (
            <Panel title="Subscription revenue collected" eyebrow={`Paystack charges · last 12 months · in ${display}`} icon={<CircleDollarSign />} actions={<A href="/admin/revenue" className="text-xs">Details</A>}>
              {o.collected.length ? <BarChart data={o.collected.map((c) => ({ label: c.month.slice(5), value: c.amount }))} format={fmt} height={170} /> : <p className="text-sm text-muted">No subscription payments recorded yet.</p>}
              <p className="mt-3 text-xs text-subtle">Charges in other currencies are converted at today&apos;s exchange rates.</p>
            </Panel>
          )}
          <Panel title="Sales rung up by pharmacies" eyebrow="Till sales · last 30 days" icon={<TrendingUp />} actions={<span className="text-sm font-semibold tabular-nums">{fmt(o.gmvTotal)}</span>}>
            <Table head={["Currency", "Pharmacies", "Amount", `In ${display}`]} empty="No sales in the last 30 days.">
              {o.gmv.map((g) => <tr key={g.currency}><Td className="font-mono text-xs">{g.currency}</Td><Td>{g.pharmacies}</Td><Td className="tabular-nums">{money(g.amount, g.currency)}</Td><Td className="tabular-nums text-muted">{fmt(g.display)}</Td></tr>)}
            </Table>
            <p className="mt-3 text-xs text-subtle">{o.activity.sales30.toLocaleString()} sales · {o.activity.customers.toLocaleString()} customers on the platform.</p>
          </Panel>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <Panel title="Pharmacies by status" icon={<Building2 />}>
            <div className="space-y-3">
              {Object.entries(o.byStatus).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <div key={k}>
                  <div className="flex items-center justify-between text-sm"><Badge tone={STATUS_TONE[k as keyof typeof STATUS_TONE] ?? "gray"}>{k.replace("_", " ")}</Badge><span className="tabular-nums">{n}</span></div>
                  <Progress value={(n / Math.max(statusTotal, 1)) * 100} className="mt-1.5" />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Paid plan mix" icon={<CircleDollarSign />}>
            <div className="space-y-2 text-sm">
              {(Object.keys(PLANS) as PlanKey[]).map((p) => (
                <div key={p} className="flex items-center justify-between"><span>{PLANS[p].name} <span className="text-subtle">· {fmt(m.lists.get(display)?.plans[p] ?? 0)}</span></span><span className="tabular-nums">{o.byPlan[p] ?? 0}</span></div>
              ))}
            </div>
          </Panel>
          <Panel title="Messaging" eyebrow="Last 30 days" icon={<MessageSquare />}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-2xl font-semibold tabular-nums">{o.messaging.whatsapp}</div><div className="text-xs text-subtle">WhatsApp sent</div></div>
              <div><div className="text-2xl font-semibold tabular-nums">{o.messaging.sms}</div><div className="text-xs text-subtle">SMS sent</div></div>
              <div><div className="text-2xl font-semibold tabular-nums">{o.messaging.sent}</div><div className="text-xs text-subtle">Delivered / sent</div></div>
              <div><div className={`text-2xl font-semibold tabular-nums ${o.messaging.failed ? "text-bad" : ""}`}>{o.messaging.failed}</div><div className="text-xs text-subtle">Failed</div></div>
            </div>
          </Panel>
          <Panel title="What the product is doing" eyebrow="Platform-wide" icon={<CalendarClock />}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-2xl font-semibold tabular-nums">{fmt(o.expiryAtRisk)}</div><div className="text-xs text-subtle">Stock (at cost) expiring within 90 days — the value our alerts protect</div></div>
              <div><div className="inline-flex items-center gap-1.5 text-2xl font-semibold tabular-nums"><WifiOff className="h-4 w-4 text-subtle" />{o.activity.offline30.toLocaleString()}</div><div className="text-xs text-subtle">Sales made offline and synced, last 30 days</div></div>
            </div>
          </Panel>
        </div>
      </section>
    </>
  );
}
