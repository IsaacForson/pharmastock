import { AlertTriangle, CalendarClock, CircleDollarSign, Hourglass, Receipt } from "lucide-react";
import Link from "next/link";
import { Badge, Kpi, PageHeader, Panel, Progress, Table, Td } from "@/components/ui";
import { dateOnly, dateTime, money } from "@/lib/format";
import { requireAdmin } from "@/lib/platform-auth";
import { revenueDetails } from "@/lib/platform-metrics";
import { controlMoney } from "../money";
import { PLANS } from "@/lib/plans";

export const metadata = { title: "Revenue" };

export default async function RevenuePage() {
  const { admin } = await requireAdmin("revenue.view");
  const { m, fmt, display } = await controlMoney(admin);
  const r = await revenueDetails(m);
  const pharmacyLink = (id: string, name: string | null) => <Link href={`/admin/pharmacies/${id}`} className="font-medium hover:text-accent">{name ?? "Deleted pharmacy"}</Link>;
  return (
    <>
      <PageHeader eyebrow="Finance" icon={<CircleDollarSign />} title="Revenue" subtitle={`Recurring revenue, what was actually collected, and the accounts that need attention. Amounts in ${display}, converted at current exchange rates.`} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="MRR" value={fmt(r.mrr)} sub={`ARR ${fmt(r.mrr * 12)}`} icon={<CircleDollarSign />} />
        <Kpi label="Setup services" value={fmt(r.setupYear)} sub="one-time, this year" icon={<Receipt />} tone="teal" />
        <Kpi label="Collected this month" value={fmt(r.collectedMonth)} sub={`${fmt(r.collectedYear)} this year`} icon={<Receipt />} tone="green" />
        <Kpi label="Past due / read-only" value={r.pastDue.length} sub="accounts to chase" icon={<AlertTriangle />} tone={r.pastDue.length ? "red" : "green"} />
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Panel title="MRR by plan" icon={<CircleDollarSign />}>
            <div className="space-y-4">
              {r.byPlan.map((p) => (
                <div key={p.plan}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{PLANS[p.plan].name} <span className="text-subtle">· {p.pharmacies} pharmacies{p.plan === "chain" ? ` · ${p.branches} branches` : ""}{p.annual ? ` (${p.annual} annual)` : ""}</span></span>
                    <span className="tabular-nums">{fmt(p.mrr)}</span>
                  </div>
                  <Progress value={r.mrr ? (p.mrr / r.mrr) * 100 : 0} className="mt-1.5" />
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Subscription payment ledger" eyebrow="Latest 100 Paystack events" icon={<Receipt />}>
            <Table head={["When", "Pharmacy", "Event", "Amount", `In ${display}`, "Reference"]} empty="No subscription events yet.">
              {r.ledger.map((e) => (
                <tr key={e.id}>
                  <Td className="text-muted">{dateTime(e.createdAt, "UTC")}</Td><Td>{pharmacyLink(e.tenantId, e.pharmacy)}</Td>
                  <Td><Badge tone={e.type === "charge.success" ? "green" : e.type.includes("fail") || e.type.includes("disable") ? "red" : "gray"}>{e.type}</Badge></Td>
                  <Td className="tabular-nums">{e.amountMinor != null ? money(e.amountMinor, e.currency ?? "USD") : "—"}</Td>
                  <Td className="tabular-nums text-muted">{e.display != null ? fmt(e.display) : "—"}</Td>
                  <Td className="font-mono text-xs text-subtle">{e.providerRef}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
        <div className="space-y-4 xl:col-span-5">
          <Panel title="Renewing in 14 days" icon={<CalendarClock />}>
            <Table head={["Pharmacy", "Plan", "Renews"]} empty="No renewals coming up.">
              {r.renewals.map((c) => <tr key={c.id}><Td>{pharmacyLink(c.id, c.name)}</Td><Td>{PLANS[c.plan].name}</Td><Td className="text-muted">{c.currentPeriodEnd ? dateOnly(c.currentPeriodEnd, "UTC") : ""}</Td></tr>)}
            </Table>
          </Panel>
          <Panel title="Trials ending in 7 days" icon={<Hourglass />}>
            <Table head={["Pharmacy", "Plan", "Ends"]} empty="No trials ending soon.">
              {r.trialsEnding.map((c) => <tr key={c.id}><Td>{pharmacyLink(c.id, c.name)}</Td><Td>{PLANS[c.plan].name}</Td><Td className="text-muted">{c.trialEndsAt ? dateOnly(c.trialEndsAt, "UTC") : ""}</Td></tr>)}
            </Table>
          </Panel>
          <Panel title="Past due & read-only" icon={<AlertTriangle />}>
            <Table head={["Pharmacy", "Status", "Period ended"]} empty="Everyone is paid up.">
              {r.pastDue.map((c) => <tr key={c.id}><Td>{pharmacyLink(c.id, c.name)}</Td><Td><Badge tone={c.planStatus === "read_only" ? "red" : "yellow"}>{c.planStatus.replace("_", " ")}</Badge></Td><Td className="text-muted">{c.currentPeriodEnd ? dateOnly(c.currentPeriodEnd, "UTC") : "—"}</Td></tr>)}
            </Table>
          </Panel>
        </div>
      </section>
    </>
  );
}
