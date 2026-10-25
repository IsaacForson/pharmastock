import { asc, ilike, max, or } from "drizzle-orm";
import { AlarmClock, Plus, Search, Truck, Wallet } from "lucide-react";
import { A, Badge, Input, Kpi, LinkButton, PageHeader, Panel, Table, Td, Toolbar } from "@/components/ui";
import { goodsReceipts, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, dateOnly, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { supplierBalances } from "@/lib/purchasing";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: PageProps<"/suppliers">) {
  const ctx = await requireCtx("purchasing.manage");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const today = localDay(ctx.tenant.timezone);
  const d = await tx(ctx, async (t) => ({
    rows: await t.select().from(suppliers).where(q ? or(ilike(suppliers.name, `%${q}%`), ilike(suppliers.contactName, `%${q}%`), ilike(suppliers.phone, `%${q}%`)) : undefined).orderBy(asc(suppliers.name)),
    balances: await supplierBalances(t, today),
    last: await t.select({ supplierId: goodsReceipts.supplierId, at: max(goodsReceipts.receivedAt) }).from(goodsReceipts).groupBy(goodsReceipts.supplierId),
  }));
  const all = [...d.balances.values()];
  const owed = all.reduce((s, b) => s + Math.max(0, b.owedMinor), 0);
  const overdue = all.reduce((s, b) => s + b.overdueMinor, 0);
  const dueSoon = all.filter((b) => b.nextDue && b.nextDue <= addDays(today, 7)).length;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader eyebrow="Stock" title="Suppliers" icon={<Truck />} subtitle="Who you buy from, what you owe them and their terms."
        actions={<>
          {can(ctx.user.role, "supplier.payments") && <LinkButton href="/suppliers/payments" variant="secondary"><Wallet className="h-4 w-4" aria-hidden />Payables</LinkButton>}
          {can(ctx.user.role, "suppliers.manage") && <LinkButton href="/suppliers/new"><Plus className="h-4 w-4" aria-hidden />Add supplier</LinkButton>}
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Suppliers" value={d.rows.filter((s) => s.active).length} icon={<Truck />} sub="active" />
        <Kpi label="You owe" value={money(owed, cur)} tone="teal" icon={<Wallet />} href="/suppliers/payments" />
        <Kpi label="Overdue" value={money(overdue, cur)} tone={overdue ? "red" : "green"} icon={<AlarmClock />} href="/suppliers/payments?view=overdue" />
        <Kpi label="Due this week" value={dueSoon} tone="yellow" icon={<AlarmClock />} sub="suppliers with a payment due" />
      </div>
      <Toolbar>
        <form className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Search suppliers" aria-label="Search suppliers" className="pl-10" />
        </form>
      </Toolbar>
      <Panel>
        <Table head={["Supplier", "Contact", "Terms", "Lead time", "Last delivery", "Owed", "Overdue"]} empty={q ? "No suppliers match" : "No suppliers yet. Add the wholesalers you buy from."}>
          {d.rows.map((s) => {
            const b = d.balances.get(s.id);
            const last = d.last.find((x) => x.supplierId === s.id)?.at;
            return (
              <tr key={s.id}>
                <Td><A href={`/suppliers/${s.id}`}>{s.name}</A>{!s.active && <span className="ml-2"><Badge>Inactive</Badge></span>}</Td>
                <Td className="text-muted">{[s.contactName, s.phone].filter(Boolean).join(" · ") || "—"}</Td>
                <Td className="text-muted">{s.paymentTermsDays ? `${s.paymentTermsDays} days` : "On delivery"}</Td>
                <Td className="text-muted">{s.leadTimeDays} days</Td>
                <Td className="text-muted">{last ? dateOnly(last, tz) : "—"}</Td>
                <Td className="tabular-nums">{b ? money(b.owedMinor, cur) : "—"}</Td>
                <Td className="tabular-nums">{b?.overdueMinor ? <span className="font-medium text-bad">{money(b.overdueMinor, cur)}</span> : <span className="text-subtle">—</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}
