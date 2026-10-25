import { eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { customers, prescriptionItems, prescriptions, products, saleLines, sales, stockBatches } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { dateOnly } from "@/lib/format";
import { PrintDoc } from "../../print-doc";

export const metadata = { title: "Dispensing labels" };

/** One label per medicine line: what it is, how to take it, for whom, from where. */
export default async function LabelsPage({ params }: PageProps<"/sales/[id]/labels">) {
  const { id } = await params;
  const ctx = await requireCtx("pos.sell");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tx(ctx, async (t) => {
    const [s] = await t.select().from(sales).where(eq(sales.id, id));
    if (!s) return null;
    const lines = await t.select({ line: saleLines, product: products }).from(saleLines).innerJoin(products, eq(products.id, saleLines.productId)).where(eq(saleLines.saleId, id));
    const meds = lines.filter((l) => l.product.schedule !== "non_drug");
    const itemIds = meds.map((l) => l.line.prescriptionItemId).filter(Boolean) as string[];
    const items = itemIds.length ? await t.select().from(prescriptionItems).where(inArray(prescriptionItems.id, itemIds)) : [];
    const batchIds = meds.flatMap((l) => l.line.allocations.map((a) => a.batchId));
    const batches = batchIds.length ? await t.select().from(stockBatches).where(inArray(stockBatches.id, batchIds)) : [];
    const [c] = s.customerId ? await t.select({ name: customers.name }).from(customers).where(eq(customers.id, s.customerId)) : [];
    const [rx] = s.prescriptionId ? await t.select({ rxNo: prescriptions.rxNo, prescriber: prescriptions.prescriberName }).from(prescriptions).where(eq(prescriptions.id, s.prescriptionId)) : [];
    await audit(t, ctx, "print", "sale", id, { customerId: s.customerId, details: { labels: meds.length } });
    return { s, meds, items, batches, customer: c?.name ?? null, rx };
  });
  if (!d) notFound();
  const warning = rulesFor(ctx.tenant.country).labelWarning;
  const t = ctx.tenant;
  return (
    <PrintDoc tenant={t} title="Dispensing labels" back={`/sales/${id}`}>
      {!d.meds.length ? <p className="text-sm text-muted">This sale has no medicines to label.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 print:grid-cols-2">
          {d.meds.map(({ line, product }) => {
            const item = d.items.find((i) => i.id === line.prescriptionItemId);
            const directions = item?.directions || [item?.dose, item?.frequency, item?.duration].filter(Boolean).join(", ");
            const b = line.allocations.map((a) => d.batches.find((x) => x.id === a.batchId)).filter(Boolean);
            return (
              <section key={line.id} className="break-inside-avoid rounded border-2 border-line-strong p-3 text-[12px] leading-snug text-fg">
                <div className="flex justify-between gap-2 border-b border-line pb-1 text-[10px] text-muted"><span className="font-semibold text-fg">{t.name}</span><span>{t.phone}</span></div>
                <div className="mt-1.5 text-sm font-bold">{product.name} {product.strength}</div>
                {product.genericName && <div className="text-muted">{product.genericName}</div>}
                <div className="mt-1">Qty: {line.baseQty} {product.baseUnit}</div>
                <div className="mt-1 min-h-8 font-semibold">{directions || <span className="inline-block w-full border-b border-dotted border-line-strong">&nbsp;</span>}</div>
                <div className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px]"><span>For: <strong>{d.customer ?? "________________"}</strong></span><span>{dateOnly(d.s.soldAt, t.timezone)}</span></div>
                <div className="text-[10px] text-muted">{[d.rx && `Rx ${d.rx.rxNo}`, d.s.saleNo, b.map((x) => `Batch ${x!.batchNo}${x!.expiry ? ` exp ${x!.expiry}` : ""}`).join(", ")].filter(Boolean).join(" · ")}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">{warning}</div>
              </section>
            );
          })}
        </div>
      )}
    </PrintDoc>
  );
}
