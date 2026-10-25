import { and, asc, desc, eq, ilike, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { FilePlus2, FileText, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, EmptyState, Input, Kpi, LinkButton, PageHeader, Panel, Table, Tabs, Td, Toolbar, type Tone } from "@/components/ui";
import { customers, prescriptions } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { addDays, localDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";

export const metadata = { title: "Prescriptions" };
const TONE: Record<string, Tone> = { active: "green", completed: "gray", cancelled: "red", expired: "yellow" };

export default async function PrescriptionsPage({ searchParams }: PageProps<"/prescriptions">) {
  const ctx = await requireCtx("prescriptions.read");
  if (!hasFeature(ctx.tenant, "prescriptions")) redirect("/settings/subscription");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const view = sp.view === "refills" || sp.view === "all" || sp.view === "unverified" ? sp.view : "active";
  const today = localDay(ctx.tenant.timezone);
  const soon = addDays(today, 7);
  const d = await tx(ctx, async (t) => {
    const conds: (SQL | undefined)[] = [];
    if (q) { const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`; conds.push(or(ilike(prescriptions.rxNo, like), ilike(customers.name, like), ilike(prescriptions.prescriberName, like))); }
    if (view === "active") conds.push(eq(prescriptions.status, "active"));
    if (view === "refills") conds.push(eq(prescriptions.status, "active"), isNotNull(prescriptions.nextRefillDue), lte(prescriptions.nextRefillDue, soon));
    if (view === "unverified") conds.push(eq(prescriptions.status, "active"), sql`${prescriptions.verifiedBy} is null`);
    const rows = await t.select({ rx: prescriptions, customer: customers.name, phone: customers.phone }).from(prescriptions).innerJoin(customers, eq(customers.id, prescriptions.customerId))
      .where(and(...conds)).orderBy(view === "refills" ? asc(prescriptions.nextRefillDue) : desc(prescriptions.createdAt)).limit(200);
    const [k] = await t.select({
      active: sql<number>`count(*) filter (where ${prescriptions.status} = 'active')::int`,
      due: sql<number>`count(*) filter (where ${prescriptions.status} = 'active' and ${prescriptions.nextRefillDue} <= ${soon})::int`,
      overdue: sql<number>`count(*) filter (where ${prescriptions.status} = 'active' and ${prescriptions.nextRefillDue} < ${today})::int`,
      unverified: sql<number>`count(*) filter (where ${prescriptions.status} = 'active' and ${prescriptions.verifiedBy} is null)::int`,
    }).from(prescriptions);
    await audit(t, ctx, "view", "prescription", null, { details: { list: view, results: rows.length } });
    return { rows, k };
  });
  const href = (v: string) => `/prescriptions?${new URLSearchParams({ ...(q ? { q } : {}), view: v })}`;
  return (
    <div>
      <PageHeader title="Prescriptions" eyebrow="Counter" icon={<FileText />} subtitle="Record, verify and dispense prescriptions; follow up on refills."
        actions={can(ctx.user.role, "prescriptions.write") && ctx.access === "full" && <LinkButton href="/prescriptions/new"><FilePlus2 className="h-4 w-4" aria-hidden /> New prescription</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Active" value={d.k.active} href={href("active")} />
        <Kpi label="Refills due this week" value={d.k.due} tone="blue" href={href("refills")} />
        <Kpi label="Overdue refills" value={d.k.overdue} tone="red" href={href("refills")} />
        <Kpi label="Waiting for a pharmacist" value={d.k.unverified} tone="yellow" href={href("unverified")} />
      </div>
      <Toolbar>
        <form className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Rx no., customer or prescriber" className="pl-9" aria-label="Search prescriptions" />
          <input type="hidden" name="view" value={view} />
        </form>
        <Tabs current={view} tabs={[
          { key: "active", label: "Active", href: href("active"), count: d.k.active }, { key: "refills", label: "Refills due", href: href("refills"), count: d.k.due },
          { key: "unverified", label: "To verify", href: href("unverified"), count: d.k.unverified }, { key: "all", label: "All", href: href("all") },
        ]} />
      </Toolbar>
      <Panel bodyClassName="p-0">
        <Table head={["Rx", "Customer", "Prescriber", "Issued", "Fills", "Next refill", "Status"]} empty={<EmptyState title="Nothing here" compact>{view === "refills" ? "No refills are due this week." : "Record a prescription to start."}</EmptyState>}>
          {d.rows.map(({ rx, customer, phone }) => (
            <tr key={rx.id} className="hover:bg-surface-2">
              <Td><Link href={`/prescriptions/${rx.id}`} className="font-mono text-xs font-semibold text-accent hover:underline">{rx.rxNo}</Link></Td>
              <Td><span className="block">{customer}</span><span className="block text-xs text-muted">{phone}</span></Td>
              <Td className="text-muted">{rx.prescriberName}</Td>
              <Td className="text-muted">{rx.issuedOn}</Td>
              <Td className="tabular-nums">{rx.refillsUsed} / {rx.refillsAllowed + 1}</Td>
              <Td>{rx.nextRefillDue ? <Badge tone={rx.nextRefillDue < today ? "red" : rx.nextRefillDue <= soon ? "yellow" : "blue"}>{rx.nextRefillDue}</Badge> : <span className="text-subtle">—</span>}</Td>
              <Td><span className="flex gap-1"><Badge tone={TONE[rx.status] ?? "gray"}>{rx.status}</Badge>{!rx.verifiedBy && rx.status === "active" && <Badge tone="yellow">unverified</Badge>}</span></Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
