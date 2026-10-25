import { outer } from "@/db";
import { and, asc, desc, eq, gt, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { Search, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { Avatar, Badge, EmptyState, Input, Kpi, LinkButton, PageHeader, Panel, Table, Tabs, Td, Toolbar } from "@/components/ui";
import { customers, prescriptions } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, e164, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const ctx = await requireCtx("customers.read");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const view = sp.view === "owing" || sp.view === "refills" ? sp.view : "all";
  const cur = ctx.tenant.currency;
  const soon = addDays(localDay(ctx.tenant.timezone), 7);
  const d = await tx(ctx, async (t) => {
    const conds: (SQL | undefined)[] = [isNull(customers.deletedAt)];
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
      const phone = q.replace(/\D/g, "").length >= 6 ? e164(q, ctx.tenant.country) : null;
      conds.push(or(ilike(customers.name, like), ilike(customers.customerNo, like), phone ? eq(customers.phone, phone) : undefined));
    }
    if (view === "owing") conds.push(gt(customers.balanceMinor, 0));
    if (view === "refills") conds.push(sql`exists (select 1 from ${prescriptions} where ${prescriptions.customerId} = ${outer(customers.id)} and ${prescriptions.status} = 'active' and ${prescriptions.nextRefillDue} <= ${soon})`);
    const rows = await t.select().from(customers).where(and(...conds))
      .orderBy(view === "owing" ? desc(customers.balanceMinor) : q ? asc(customers.name) : desc(customers.createdAt)).limit(200);
    const [k] = await t.select({ n: sql<number>`count(*)::int`, owing: sql<number>`coalesce(sum(${customers.balanceMinor}) filter (where ${customers.balanceMinor} > 0), 0)::int`, debtors: sql<number>`count(*) filter (where ${customers.balanceMinor} > 0)::int`, consent: sql<number>`count(*) filter (where ${customers.messagingConsent} and ${customers.optedOutAt} is null)::int` })
      .from(customers).where(isNull(customers.deletedAt));
    const [r] = await t.select({ n: sql<number>`count(*)::int` }).from(prescriptions).where(and(eq(prescriptions.status, "active"), lte(prescriptions.nextRefillDue, soon)));
    return { rows, k, refills: r.n };
  });
  const href = (v: string) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(v !== "all" ? { view: v } : {}) })}`;
  return (
    <div>
      <PageHeader title="Customers" eyebrow="Counter" icon={<Users />} subtitle="Purchase history, accounts, prescriptions and reminders."
        actions={can(ctx.user.role, "customers.write") && <LinkButton href="/customers/new"><UserPlus className="h-4 w-4" aria-hidden /> Add customer</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Customers" value={d.k.n} />
        <Kpi label="Owed to you" value={money(d.k.owing, cur)} sub={`${d.k.debtors} on account`} tone="yellow" href={href("owing")} />
        <Kpi label="Refills due this week" value={d.refills} tone="blue" href={href("refills")} />
        <Kpi label="Agreed to messages" value={d.k.consent} tone="green" />
      </div>
      <Toolbar>
        <form className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Name, phone or customer no." className="pl-9" aria-label="Search customers" />
          {view !== "all" && <input type="hidden" name="view" value={view} />}
        </form>
        <Tabs current={view} tabs={[{ key: "all", label: "All", href: href("all") }, { key: "owing", label: "Owing", href: href("owing"), count: d.k.debtors }, { key: "refills", label: "Refills due", href: href("refills"), count: d.refills }]} />
      </Toolbar>
      <Panel bodyClassName="p-0">
        <Table head={["Customer", "Phone", "Owes", "Points", "Messages"]} empty={<EmptyState title={q ? "No customer matches" : "No customers yet"} compact>{q ? "Try a phone number or part of the name." : "Add customers at the till or here."}</EmptyState>}>
          {d.rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface-2">
              <Td><Link href={`/customers/${c.id}`} className="flex items-center gap-3"><Avatar name={c.name} size="sm" /><span><span className="block font-medium text-fg">{c.name}</span><span className="block font-mono text-xs text-muted">{c.customerNo}</span></span></Link></Td>
              <Td className="text-muted">{c.phone ?? "—"}</Td>
              <Td className={c.balanceMinor > 0 ? "tabular-nums font-medium text-warn" : "tabular-nums text-muted"}>{money(c.balanceMinor, cur)}</Td>
              <Td className="tabular-nums text-muted">{c.loyaltyPoints}</Td>
              <Td>{c.optedOutAt ? <Badge tone="red">opted out</Badge> : c.messagingConsent ? <Badge tone="green">agreed</Badge> : <Badge>not asked</Badge>}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
