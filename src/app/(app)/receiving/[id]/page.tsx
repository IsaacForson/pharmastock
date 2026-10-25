import { and, eq } from "drizzle-orm";
import { Paperclip } from "lucide-react";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/form";
import { A, Badge } from "@/components/ui";
import { branches, documents, goodsReceiptLines, goodsReceipts, productUnits, products, purchaseOrders, suppliers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, dateTime, money } from "@/lib/format";
import { Letterhead, Sheet } from "../../purchasing/letterhead";

export const metadata = { title: "Goods received note" };

export default async function GrnPage({ params }: PageProps<"/receiving/[id]">) {
  const ctx = await requireCtx("stock.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tx(ctx, async (t) => {
    const [row] = await t.select({ g: goodsReceipts, s: suppliers, b: branches, poNo: purchaseOrders.poNo, by: users.name }).from(goodsReceipts)
      .leftJoin(suppliers, eq(suppliers.id, goodsReceipts.supplierId)).innerJoin(branches, eq(branches.id, goodsReceipts.branchId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.poId)).leftJoin(users, eq(users.id, goodsReceipts.receivedBy)).where(eq(goodsReceipts.id, id));
    if (!row) return null;
    const lines = await t.select({ l: goodsReceiptLines, name: products.name, strength: products.strength, unit: productUnits.name, factor: productUnits.factor, baseUnit: products.baseUnit })
      .from(goodsReceiptLines).innerJoin(products, eq(products.id, goodsReceiptLines.productId)).innerJoin(productUnits, eq(productUnits.id, goodsReceiptLines.unitId))
      .where(eq(goodsReceiptLines.receiptId, id)).orderBy(products.name);
    const docs = await t.select({ id: documents.id, name: documents.name }).from(documents).where(and(eq(documents.entity, "goods_receipt"), eq(documents.entityId, id)));
    return { ...row, lines, docs };
  });
  if (!d) notFound();
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const { g } = d;
  const unpaid = g.totalMinor - g.paidMinor;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden"><A href="/receiving">← All deliveries</A><PrintButton /></div>
      <Sheet>
        <Letterhead tenant={ctx.tenant} branch={d.b} title="Goods received note" number={g.grnNo}>
          <div>Received {dateTime(g.receivedAt, tz)}</div>
          {d.by && <div>By {d.by}</div>}
        </Letterhead>
        <section className="grid gap-4 text-sm sm:grid-cols-3">
          <div><div className="text-[10px] font-mono uppercase tracking-wider text-subtle">Supplier</div><div className="mt-1 font-medium text-fg">{d.s ? <A href={`/suppliers/${d.s.id}`}>{d.s.name}</A> : "No supplier"}</div></div>
          <div><div className="text-[10px] font-mono uppercase tracking-wider text-subtle">Invoice / order</div><div className="mt-1 text-fg">{g.supplierInvoiceNo ?? "—"}{d.poNo && <> · <A href={`/purchasing/${g.poId}`} className="font-mono text-xs">{d.poNo}</A></>}</div></div>
          <div><div className="text-[10px] font-mono uppercase tracking-wider text-subtle">Payment</div>
            <div className="mt-1 flex items-center gap-2 text-fg">{g.dueAt ? `Due ${dateOnly(g.dueAt, "UTC")}` : "—"} {unpaid <= 0 ? <Badge tone="green">Paid</Badge> : g.paidMinor > 0 ? <Badge tone="blue">{money(unpaid, cur)} left</Badge> : null}</div></div>
        </section>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-subtle">
            <th className="py-2">Product</th><th className="py-2">Batch</th><th className="py-2">Expiry</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Free</th><th className="py-2 text-right">Cost/pack</th><th className="py-2 text-right">Total</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {d.lines.map(({ l, name, strength, unit }) => (
              <tr key={l.id}>
                <td className="py-2"><div className="font-medium text-fg">{name} {strength}</div><div className="text-xs text-muted">{unit}{l.mfgDate ? ` · mfg ${l.mfgDate}` : ""}</div></td>
                <td className="py-2 font-mono text-xs">{l.batchNo || "—"}</td>
                <td className="py-2 tabular-nums">{l.expiry ? dateOnly(l.expiry, "UTC") : "—"}</td>
                <td className="py-2 text-right tabular-nums">{l.qty}</td>
                <td className="py-2 text-right tabular-nums text-muted">{l.freeQty || ""}</td>
                <td className="py-2 text-right tabular-nums">{money(l.unitCostMinor, cur)}</td>
                <td className="py-2 text-right tabular-nums">{money(l.qty * l.unitCostMinor, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line-strong"><td colSpan={6} className="py-3 text-right font-semibold">Total</td><td className="py-3 text-right text-base font-semibold tabular-nums">{money(g.totalMinor, cur)}</td></tr></tfoot>
        </table>
        {g.notes && <p className="whitespace-pre-line text-sm text-muted"><span className="font-medium text-fg">Notes: </span>{g.notes}</p>}
        {d.docs.length > 0 && (
          <div className="flex flex-wrap gap-2 print:hidden">
            {d.docs.map((doc) => <a key={doc.id} href={`/api/files/${doc.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded border border-line bg-surface-2 px-2.5 py-1.5 text-xs text-fg hover:bg-surface-3"><Paperclip className="h-3.5 w-3.5" aria-hidden />{doc.name}</a>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-10 pt-8 text-xs text-muted">
          <div className="border-t border-line pt-2">Received by (signature)</div>
          <div className="border-t border-line pt-2">Checked by (signature)</div>
        </div>
      </Sheet>
    </div>
  );
}
