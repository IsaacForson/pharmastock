import { outer } from "@/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { PackagePlus, Truck } from "lucide-react";
import { A, Badge, Kpi, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { goodsReceiptLines, goodsReceipts, purchaseOrders, suppliers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, dateTime, dayRange, localDay, money } from "@/lib/format";
import { PO_STATUS } from "../purchasing/status";

export const metadata = { title: "Receive stock" };

export default async function ReceivingPage() {
  const ctx = await requireCtx("stock.receive");
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const weekStart = dayRange(addDays(localDay(tz), -6), tz).start;
  const d = await tx(ctx, async (t) => ({
    rows: await t.select({ g: goodsReceipts, supplier: suppliers.name, poNo: purchaseOrders.poNo, by: users.name, lines: sql<number>`(select count(*)::int from ${goodsReceiptLines} where ${goodsReceiptLines.receiptId} = ${outer(goodsReceipts.id)})` })
      .from(goodsReceipts).leftJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId)).leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId)).leftJoin(users, eq(users.id, goodsReceipts.receivedBy))
      .where(eq(goodsReceipts.branchId, ctx.branchId)).orderBy(desc(goodsReceipts.receivedAt)).limit(200),
    week: (await t.select({ n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${goodsReceipts.totalMinor}),0)::int` }).from(goodsReceipts)
      .where(and(eq(goodsReceipts.branchId, ctx.branchId), gte(goodsReceipts.receivedAt, weekStart))))[0],
    awaiting: await t.select({ po: purchaseOrders, supplier: suppliers.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(eq(purchaseOrders.branchId, ctx.branchId), inArray(purchaseOrders.status, ["sent", "confirmed", "partially_received"]))).orderBy(purchaseOrders.expectedAt),
  }));

  return (
    <>
      <PageHeader eyebrow="Stock" title="Receive stock" icon={<PackagePlus />} subtitle="Goods received notes: every delivery with its batches and expiry dates."
        actions={<LinkButton href="/receiving/new"><PackagePlus className="h-4 w-4" aria-hidden />Receive a delivery</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Deliveries this week" value={d.week.n} icon={<Truck />} />
        <Kpi label="Received this week" value={money(d.week.v, cur)} tone="teal" icon={<PackagePlus />} sub="at cost" />
        <Kpi label="Orders awaiting delivery" value={d.awaiting.length} tone="blue" icon={<Truck />} href="/purchasing?status=sent" />
      </div>
      {d.awaiting.length > 0 && (
        <Panel title="Expected deliveries" eyebrow="Open orders" className="mb-6">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {d.awaiting.map(({ po, supplier }) => (
              <a key={po.id} href={`/receiving/new?po=${po.id}`} className="flex items-center justify-between gap-3 rounded border border-line bg-surface-2 px-3.5 py-3 transition hover:border-line-strong hover:bg-surface-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{supplier}</span>
                  <span className="block font-mono text-xs text-muted">{po.poNo}{po.expectedAt ? ` · due ${po.expectedAt}` : ""}</span>
                </span>
                <Badge tone={PO_STATUS[po.status].tone}>{PO_STATUS[po.status].label}</Badge>
              </a>
            ))}
          </div>
        </Panel>
      )}
      <Panel>
        <Table head={["GRN", "Supplier", "Order", "Invoice", "Received", "By", "Lines", "Total"]} empty="No deliveries received yet">
          {d.rows.map(({ g, supplier, poNo, by, lines }) => (
            <tr key={g.id}>
              <Td><A href={`/receiving/${g.id}`} className="font-mono text-xs">{g.grnNo}</A></Td>
              <Td className="font-medium">{supplier ?? <span className="text-muted">No supplier</span>}</Td>
              <Td className="font-mono text-xs text-muted">{poNo ? <A href={`/purchasing/${g.poId}`}>{poNo}</A> : "—"}</Td>
              <Td className="text-muted">{g.supplierInvoiceNo ?? "—"}</Td>
              <Td className="text-muted">{dateTime(g.receivedAt, tz)}</Td>
              <Td className="text-muted">{by ?? "—"}</Td>
              <Td className="tabular-nums">{lines}</Td>
              <Td className="text-right tabular-nums">{money(g.totalMinor, cur)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
