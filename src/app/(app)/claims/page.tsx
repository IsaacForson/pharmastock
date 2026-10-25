import { desc, eq, sql } from "drizzle-orm";
import { BadgeCheck, Building2, FilePlus2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, EmptyState, Kpi, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { CLAIM_TONE } from "./tone";
import { claims, payers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { awaitingClaim } from "@/lib/claims";
import { money } from "@/lib/format";
import { hasFeature } from "@/lib/plans";

export const metadata = { title: "Insurance claims" };

export default async function ClaimsPage() {
  const ctx = await requireCtx("claims.manage");
  if (!hasFeature(ctx.tenant, "claims")) redirect("/settings/subscription");
  const cur = ctx.tenant.currency;
  const d = await tx(ctx, async (t) => {
    const waiting = await awaitingClaim(t, ctx.tenant.timezone);
    const batches = await t.select({ c: claims, payer: payers.name }).from(claims).innerJoin(payers, eq(payers.id, claims.payerId)).orderBy(desc(claims.createdAt)).limit(100);
    const outstanding = await t.select({ payerId: claims.payerId, name: payers.name, due: sql<number>`sum(${claims.totalClaimedMinor} - ${claims.totalPaidMinor})::int`, n: sql<number>`count(*)::int` })
      .from(claims).innerJoin(payers, eq(payers.id, claims.payerId)).where(sql`${claims.status} in ('submitted', 'partially_paid')`).groupBy(claims.payerId, payers.name);
    return { waiting, batches, outstanding };
  });
  const byPayer = new Map<string, { name: string; n: number; total: number }>();
  for (const w of d.waiting) {
    const k = w.sale.payerId!;
    const cur0 = byPayer.get(k) ?? { name: w.payer, n: 0, total: 0 };
    byPayer.set(k, { ...cur0, n: cur0.n + 1, total: cur0.total + w.claimable });
  }
  const owed = d.outstanding.reduce((s, o) => s + o.due, 0);
  const toClaim = [...byPayer.values()].reduce((s, o) => s + o.total, 0);
  return (
    <div>
      <PageHeader title="Insurance claims" eyebrow="Business" icon={<BadgeCheck />} subtitle="Claim the insurer, HMO or company share of sales, and track what they pay."
        actions={<><LinkButton variant="secondary" href="/claims/payers"><Building2 className="h-4 w-4" aria-hidden /> Payers</LinkButton><LinkButton href="/claims/new"><FilePlus2 className="h-4 w-4" aria-hidden /> New claim</LinkButton></>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Waiting to be claimed" value={money(toClaim, cur)} sub={`${d.waiting.length} sales`} tone="yellow" />
        <Kpi label="Claimed, not yet paid" value={money(owed, cur)} sub={`${d.outstanding.reduce((s, o) => s + o.n, 0)} claims`} tone="blue" />
        <Kpi label="Payers owing" value={d.outstanding.length} />
        <Kpi label="Draft claims" value={d.batches.filter((b) => b.c.status === "draft").length} tone="gray" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Sales waiting to be claimed" bodyClassName="p-0">
          <Table head={["Payer", "Sales", "Amount", ""]} empty={<EmptyState title="Nothing to claim" compact>Sales with an insurer share show up here.</EmptyState>}>
            {[...byPayer.entries()].map(([id, p]) => (
              <tr key={id}><Td>{p.name}</Td><Td className="tabular-nums">{p.n}</Td><Td className="tabular-nums">{money(p.total, cur)}</Td><Td><Link href={`/claims/new?payer=${id}`} className="text-sm font-medium text-accent hover:underline">Claim</Link></Td></tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Outstanding by payer" bodyClassName="p-0">
          <Table head={["Payer", "Claims", "Still owed"]} empty={<EmptyState title="Nobody owes you" compact />}>
            {d.outstanding.map((o) => <tr key={o.payerId}><Td>{o.name}</Td><Td className="tabular-nums">{o.n}</Td><Td className="font-medium tabular-nums">{money(o.due, cur)}</Td></tr>)}
          </Table>
        </Panel>
      </div>
      <Panel title="Claims" className="mt-4" bodyClassName="p-0">
        <Table head={["Claim", "Payer", "Period", "Claimed", "Paid", "Status"]} empty={<EmptyState title="No claims yet" compact />}>
          {d.batches.map(({ c, payer }) => (
            <tr key={c.id} className="hover:bg-surface-2">
              <Td><Link href={`/claims/${c.id}`} className="font-mono text-xs font-semibold text-accent hover:underline">{c.batchNo}</Link></Td>
              <Td>{payer}</Td><Td className="text-muted">{c.periodStart} – {c.periodEnd}</Td>
              <Td className="tabular-nums">{money(c.totalClaimedMinor, cur)}</Td><Td className="tabular-nums">{money(c.totalPaidMinor, cur)}</Td>
              <Td><Badge tone={CLAIM_TONE[c.status]}>{c.status.replace("_", " ")}</Badge></Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
