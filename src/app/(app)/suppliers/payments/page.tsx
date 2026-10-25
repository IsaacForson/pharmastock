import { and, desc, eq, sql } from "drizzle-orm";
import { AlarmClock, CalendarClock, Wallet } from "lucide-react";
import { A, Badge, Kpi, PageHeader, Panel, Table, Tabs, Td } from "@/components/ui";
import { goodsReceipts, supplierPayments, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, dateOnly, localDay, money } from "@/lib/format";
import { agingBucket, BUCKET_LABELS } from "@/lib/purchasing";

export const metadata = { title: "Supplier payments" };

const VIEWS = ["open", "overdue", "week", "paid"] as const;

/** Accounts payable: unpaid deliveries by due date across all branches, and recent payments. */
export default async function PayablesPage({ searchParams }: PageProps<"/suppliers/payments">) {
  const ctx = await requireCtx("supplier.payments");
  const sp = await searchParams;
  const view = VIEWS.includes(sp.view as (typeof VIEWS)[number]) ? (sp.view as (typeof VIEWS)[number]) : "open";
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const today = localDay(tz);
  const d = await tx(ctx, async (t) => ({
    open: await t.select({ g: goodsReceipts, supplier: suppliers.name }).from(goodsReceipts).innerJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId))
      .where(sql`${goodsReceipts.totalMinor} > ${goodsReceipts.paidMinor}`).orderBy(sql`${goodsReceipts.dueAt} asc nulls last`),
    paid: view === "paid" ? await t.select({ p: supplierPayments, supplier: suppliers.name, grnNo: goodsReceipts.grnNo }).from(supplierPayments)
      .innerJoin(suppliers, eq(suppliers.id, supplierPayments.supplierId)).leftJoin(goodsReceipts, and(eq(goodsReceipts.id, supplierPayments.receiptId)))
      .orderBy(desc(supplierPayments.paidAt), desc(supplierPayments.createdAt)).limit(200) : [],
  }));
  const left = (g: (typeof d.open)[number]["g"]) => g.totalMinor - g.paidMinor;
  const overdue = d.open.filter((r) => r.g.dueAt && r.g.dueAt < today);
  const week = d.open.filter((r) => r.g.dueAt && r.g.dueAt >= today && r.g.dueAt <= addDays(today, 7));
  const rows = view === "overdue" ? overdue : view === "week" ? week : d.open;
  const sum = (xs: typeof d.open) => xs.reduce((s, r) => s + left(r.g), 0);

  return (
    <>
      <PageHeader eyebrow="Suppliers" title="Supplier payments" icon={<Wallet />} subtitle="Unpaid deliveries by due date. Record payments on the supplier's page." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Unpaid" value={money(sum(d.open), cur)} tone="teal" icon={<Wallet />} sub={`${d.open.length} deliveries`} />
        <Kpi label="Overdue" value={money(sum(overdue), cur)} tone={overdue.length ? "red" : "green"} icon={<AlarmClock />} sub={`${overdue.length} deliveries`} href="/suppliers/payments?view=overdue" />
        <Kpi label="Due in 7 days" value={money(sum(week), cur)} tone="yellow" icon={<CalendarClock />} sub={`${week.length} deliveries`} href="/suppliers/payments?view=week" />
      </div>
      <Tabs current={view} tabs={[
        { key: "open", href: "/suppliers/payments", label: "All unpaid", count: d.open.length },
        { key: "overdue", href: "/suppliers/payments?view=overdue", label: "Overdue", count: overdue.length },
        { key: "week", href: "/suppliers/payments?view=week", label: "Due this week", count: week.length },
        { key: "paid", href: "/suppliers/payments?view=paid", label: "Payments made" },
      ]} />
      <Panel>
        {view === "paid" ? (
          <Table head={["Date", "Supplier", "Against", "Method", "Reference", "Amount"]} empty="No payments recorded yet">
            {d.paid.map(({ p, supplier, grnNo }) => (
              <tr key={p.id}>
                <Td className="text-muted">{dateOnly(p.paidAt, "UTC")}</Td>
                <Td><A href={`/suppliers/${p.supplierId}`}>{supplier}</A></Td>
                <Td className="font-mono text-xs text-muted">{grnNo ?? "advance"}</Td>
                <Td className="capitalize">{p.method.replace("_", " ")}</Td>
                <Td className="text-muted">{p.reference ?? "—"}</Td>
                <Td className="text-right tabular-nums">{money(p.amountMinor, cur)}</Td>
              </tr>
            ))}
          </Table>
        ) : (
          <Table head={["Due", "Supplier", "Delivery", "Invoice", "Status", "Total", "Unpaid"]} empty="Nothing unpaid here">
            {rows.map(({ g, supplier }) => {
              const b = agingBucket(g.dueAt, today);
              return (
                <tr key={g.id}>
                  <Td className={b !== "current" ? "font-medium text-bad" : "text-muted"}>{g.dueAt ? dateOnly(g.dueAt, "UTC") : "—"}</Td>
                  <Td><A href={`/suppliers/${g.supplierId}`}>{supplier}</A></Td>
                  <Td><A href={`/receiving/${g.id}`} className="font-mono text-xs">{g.grnNo}</A></Td>
                  <Td className="text-muted">{g.supplierInvoiceNo ?? "—"}</Td>
                  <Td><Badge tone={b === "current" ? (g.paidMinor ? "blue" : "gray") : "red"}>{b === "current" ? (g.paidMinor ? "Part paid" : "Not yet due") : BUCKET_LABELS[b]}</Badge></Td>
                  <Td className="tabular-nums text-muted">{money(g.totalMinor, cur)}</Td>
                  <Td className="text-right font-medium tabular-nums">{money(left(g), cur)}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </>
  );
}
