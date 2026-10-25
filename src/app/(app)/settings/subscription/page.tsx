import { desc } from "drizzle-orm";
import { CheckCircle2, Gem, Receipt, Rocket } from "lucide-react";
import { and, count, eq } from "drizzle-orm";
import { ActionForm, Submit } from "@/components/form";
import { Badge, Callout, Dl, EmptyState, Panel, Table, Td } from "@/components/ui";
import { billingEvents, branches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, dateTime, money } from "@/lib/format";
import { pharmacyBilling } from "@/lib/currency";
import { monthlyPrice, subscriptionTotal } from "@/lib/money";
import { billableBranches, CHAIN_MIN_BRANCHES, PLANS, type PlanKey } from "@/lib/plans";
import { checkoutAction, setupCheckoutAction } from "./actions";
import { PlanGrid } from "./plans";
import { planHighlights, planLimitsLine, SETUP_TIERS } from "./pricing";

export const metadata = { title: "Subscription" };
const STATUS_TONE = { trialing: "blue", active: "green", past_due: "yellow", read_only: "red", cancelled: "gray" } as const;

export default async function SubscriptionPage({ searchParams }: PageProps<"/settings/subscription">) {
  const ctx = await requireCtx("subscription.manage");
  const t = ctx.tenant;
  const paid = (await searchParams).paid;
  const [events, [{ n: activeBranches }]] = await tx(ctx, (x) => Promise.all([
    x.select().from(billingEvents).orderBy(desc(billingEvents.createdAt)).limit(50),
    x.select({ n: count() }).from(branches).where(and(eq(branches.tenantId, t.id), eq(branches.active, true))),
  ]));
  const { display, charge, chargeable } = await pharmacyBilling(t.currency);
  const fmt = (minor: number) => money(minor, display.currency);
  const plans = (Object.keys(PLANS) as PlanKey[]).map((key) => {
    const p = PLANS[key];
    const billed = billableBranches(key, activeBranches);
    const annual = subscriptionTotal(display, key, "annual", activeBranches);
    const h = planHighlights(key);
    return {
      key, name: p.name, monthlyLabel: fmt(monthlyPrice(display, key, activeBranches)), annualLabel: fmt(annual), annualPerMonthLabel: fmt(Math.round(annual / 12)),
      unitNote: key === "chain" ? `${fmt(display.plans.chain)} per branch × ${billed} branches` : null,
      limits: planLimitsLine(key), lead: h.lead, features: h.features,
      current: key === t.plan, recommended: key === "pro",
      cta: key === t.plan && t.planStatus === "active" ? "Renew" : `Choose ${p.name}`,
    };
  });
  return (
    <>
      {paid && <Callout tone="green" icon={<CheckCircle2 />}>Thank you — your payment is being confirmed. This page updates once Paystack notifies us (usually within a minute).</Callout>}

      <section className="glass relative overflow-hidden p-6 animate-rise">
        <div className="pointer-events-none absolute -left-16 -top-24 h-56 w-56 rounded-full bg-aurora opacity-20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">Current plan</div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-aurora text-3xl font-semibold tracking-tight">{PLANS[t.plan].name}</span>
              <Badge tone={STATUS_TONE[t.planStatus]}>{t.planStatus.replace("_", " ")}</Badge>
            </div>
            <p className="mt-1 text-sm capitalize text-muted">{t.billingCycle} billing</p>
          </div>
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-accent/25 bg-accent/15 text-accent" aria-hidden><Gem className="h-6 w-6" /></span>
        </div>
        <div className="relative mt-6 border-t border-line pt-5">
          <Dl cols={3} items={[
            ["Trial ends", t.planStatus === "trialing" ? dateOnly(t.trialEndsAt, t.timezone) : null],
            ["Current period ends", dateOnly(t.currentPeriodEnd, t.timezone)],
            ["Branches", t.plan === "chain" ? `${activeBranches} active · billed for ${t.billedBranches} (minimum ${CHAIN_MIN_BRANCHES})` : `${activeBranches} active`],
            ["Access", ctx.access === "full" ? "Full" : "Read-only — your data is safe and can still be viewed and exported"],
          ]} />
        </div>
      </section>

      <PlanGrid plans={plans} action={checkoutAction} initialCycle={t.billingCycle === "annual" ? "annual" : "monthly"} />
      <p className="text-center text-xs text-subtle">Pay monthly by card or mobile money, or yearly and get 2 months free.{!chargeable && ` Paystack can't charge ${display.currency}, so payments are taken in USD (${money(charge.plans.pro, "USD")} a month for Pro); local prices are estimates.`} Reminders, backups and data export are included in every plan. If a payment lapses, your account becomes read-only — never locked.</p>

      <Panel title="Setup service" eyebrow="One-time · done for you" icon={<Rocket />}>
        <p className="mb-4 text-sm text-muted">The slowest part of starting is entering your stock. Let our team do it.</p>
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(SETUP_TIERS).map(([key, m]) => (
            <ActionForm key={key} action={setupCheckoutAction} className="flex flex-col rounded-2xl border border-line bg-surface p-4 transition hover:border-line-strong">
              <input type="hidden" name="tier" value={key} />
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-medium text-fg">{m.name}</p>
                <p className="text-lg font-semibold tabular-nums text-fg">{fmt(display.setup[key as keyof typeof display.setup])}</p>
              </div>
              <p className="flex-1 text-sm text-muted">{m.detail}</p>
              <Submit variant="secondary" className="w-full">Pay {fmt(display.setup[key as keyof typeof display.setup])}</Submit>
            </ActionForm>
          ))}
        </div>
      </Panel>

      <Panel title="Billing history" eyebrow={`${events.length} event${events.length === 1 ? "" : "s"}`} icon={<Receipt />}>
        {events.length === 0 ? (
          <EmptyState compact icon={<Receipt />} title="No payments yet">Receipts from Paystack show up here once you choose a plan.</EmptyState>
        ) : (
          <Table head={["Date", "Event", "Amount", "Reference"]}>
            {events.map((e) => (
              <tr key={e.id}>
                <Td className="text-muted tabular-nums">{dateTime(e.createdAt, t.timezone)}</Td>
                <Td><Badge tone={/fail/i.test(e.type) ? "red" : /success|paid|charge/i.test(e.type) ? "green" : "gray"}>{e.type.replace(/[._]/g, " ")}</Badge></Td>
                <Td className="font-medium tabular-nums">{e.amountMinor != null ? money(e.amountMinor, e.currency ?? "USD") : ""}</Td>
                <Td className="font-mono text-xs text-muted">{e.providerRef}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
