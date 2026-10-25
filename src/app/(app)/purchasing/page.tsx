import { and, desc, eq, sql } from "drizzle-orm";
import { ClipboardList, Plus, ShoppingCart, Sparkles, Truck } from "lucide-react";
import { A, Badge, Kpi, LinkButton, PageHeader, Panel, Table, Tabs, Td } from "@/components/ui";
import { purchaseOrders, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, money } from "@/lib/format";
import { PO_STATUS } from "./status";

export const metadata = { title: "Purchasing" };

const FILTERS = ["open", "draft", "sent", "confirmed", "partially_received", "received", "cancelled", "all"] as const;
type Filter = (typeof FILTERS)[number];

export default async function PurchasingPage({ searchParams }: PageProps<"/purchasing">) {
  const ctx = await requireCtx("purchasing.manage");
  const sp = await searchParams;
  const status: Filter = FILTERS.includes(sp.status as Filter) ? (sp.status as Filter) : "open";
  const { rows, counts } = await tx(ctx, async (t) => {
    const where = and(eq(purchaseOrders.branchId, ctx.branchId),
      status === "all" ? undefined : status === "open" ? sql`${purchaseOrders.status} in ('draft','sent','confirmed','partially_received')` : eq(purchaseOrders.status, status));
    const rows = await t.select({ po: purchaseOrders, supplier: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(where).orderBy(desc(purchaseOrders.createdAt)).limit(200);
    const counts = await t.select({ status: purchaseOrders.status, n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${purchaseOrders.totalMinor}),0)::int` })
      .from(purchaseOrders).where(eq(purchaseOrders.branchId, ctx.branchId)).groupBy(purchaseOrders.status);
    return { rows, counts };
  });
  const c = (s: string) => counts.find((x) => x.status === s);
  const openN = ["draft", "sent", "confirmed", "partially_received"].reduce((n, s) => n + (c(s)?.n ?? 0), 0);
  const openValue = ["sent", "confirmed", "partially_received"].reduce((n, s) => n + (c(s)?.total ?? 0), 0);
  const cur = ctx.tenant.currency;

  return (
    <>
      <PageHeader eyebrow="Stock" title="Purchasing" icon={<ShoppingCart />} subtitle="Orders to your suppliers, from draft to delivered."
        actions={<>
          <LinkButton href="/purchasing/reorder" variant="secondary"><Sparkles className="h-4 w-4" aria-hidden />What to reorder</LinkButton>
          <LinkButton href="/purchasing/new"><Plus className="h-4 w-4" aria-hidden />New order</LinkButton>
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Open orders" value={openN} icon={<ClipboardList />} sub="draft to part received" />
        <Kpi label="Drafts" value={c("draft")?.n ?? 0} tone="gray" icon={<ClipboardList />} sub="not sent yet" href="/purchasing?status=draft" />
        <Kpi label="Awaiting delivery" value={(c("sent")?.n ?? 0) + (c("confirmed")?.n ?? 0) + (c("partially_received")?.n ?? 0)} tone="blue" icon={<Truck />} href="/purchasing?status=sent" />
        <Kpi label="On order" value={money(openValue, cur)} tone="teal" icon={<ShoppingCart />} sub="sent, not yet received" />
      </div>
      <Tabs current={status} tabs={FILTERS.map((f) => ({ key: f, href: `/purchasing?status=${f}`, label: f === "open" ? "Open" : f === "all" ? "All" : PO_STATUS[f].label, count: f === "open" ? openN : f === "all" ? undefined : c(f)?.n ?? 0 }))} />
      <Panel>
        <Table head={["Order", "Supplier", "Status", "Created", "Expected", "Sent", "Total"]} empty={status === "open" ? "No open orders. See what to reorder to start one." : "No orders here"}>
          {rows.map(({ po, supplier }) => (
            <tr key={po.id}>
              <Td><A href={`/purchasing/${po.id}`} className="font-mono text-xs">{po.poNo}</A></Td>
              <Td className="font-medium">{supplier}</Td>
              <Td><Badge tone={PO_STATUS[po.status].tone}>{PO_STATUS[po.status].label}</Badge></Td>
              <Td className="text-muted">{dateOnly(po.createdAt, ctx.tenant.timezone)}</Td>
              <Td className="text-muted">{po.expectedAt ? dateOnly(po.expectedAt, "UTC") : "—"}</Td>
              <Td className="text-muted">{po.sentAt ? `${dateOnly(po.sentAt, ctx.tenant.timezone)} · ${po.sentVia}` : "—"}</Td>
              <Td className="text-right tabular-nums">{money(po.totalMinor, cur)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
