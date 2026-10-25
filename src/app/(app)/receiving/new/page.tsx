import { and, asc, eq, inArray } from "drizzle-orm";
import { PackagePlus } from "lucide-react";
import { notFound } from "next/navigation";
import { A, PageHeader } from "@/components/ui";
import { productUnits, purchaseOrderLines, purchaseOrders, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { PO_OPEN } from "@/lib/purchasing";
import { loadCatalog } from "../../purchasing/catalog";
import { GrnWorkspace, type DraftLine } from "../grn-workspace";

export const metadata = { title: "Receive a delivery" };

export default async function NewGrnPage({ searchParams }: PageProps<"/receiving/new">) {
  const ctx = await requireCtx("stock.receive");
  const sp = await searchParams;
  const poId = typeof sp.po === "string" && /^[0-9a-f-]{36}$/.test(sp.po) ? sp.po : null;
  const d = await tx(ctx, async (t) => {
    const [catalog, sups, openPos] = await Promise.all([
      loadCatalog(t, { branchId: ctx.branchId, withBatches: true }),
      t.select().from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
      t.select({ id: purchaseOrders.id, poNo: purchaseOrders.poNo, supplierId: purchaseOrders.supplierId }).from(purchaseOrders)
        .where(and(eq(purchaseOrders.branchId, ctx.branchId), inArray(purchaseOrders.status, ["sent", "confirmed", "partially_received"]))).orderBy(asc(purchaseOrders.poNo)),
    ]);
    if (!poId) return { catalog, sups, openPos, po: null, lines: [] as DraftLine[] };
    const [po] = await t.select().from(purchaseOrders).where(eq(purchaseOrders.id, poId));
    if (!po) return null;
    const pl = await t.select({ l: purchaseOrderLines, factor: productUnits.factor }).from(purchaseOrderLines).innerJoin(productUnits, eq(productUnits.id, purchaseOrderLines.unitId)).where(eq(purchaseOrderLines.poId, poId));
    const lines: DraftLine[] = pl.map(({ l, factor }) => ({ productId: l.productId, unitId: l.unitId, poLineId: l.id, qty: Math.max(0, Math.ceil((l.qty * factor - l.receivedBaseQty) / factor)), cost: l.unitCostMinor })).filter((l) => l.qty > 0);
    // A supplier that never sent anything on the inactive list still needs to be selectable for its own PO.
    const sup = sups.some((s) => s.id === po.supplierId) ? sups : [...sups, ...(await t.select().from(suppliers).where(eq(suppliers.id, po.supplierId)))];
    return { catalog, sups: sup, openPos, po, lines };
  });
  if (!d) notFound();
  if (d.po && !(PO_OPEN as readonly string[]).includes(d.po.status)) {
    return <><PageHeader title="This order is closed" icon={<PackagePlus />} /><A href={`/purchasing/${d.po.id}`}>Back to {d.po.poNo}</A></>;
  }
  return (
    <>
      <PageHeader eyebrow={d.po ? <span className="font-mono">{d.po.poNo}</span> : "Stock"} title="Receive a delivery" icon={<PackagePlus />}
        subtitle="Scan each product, then type quantity, batch number, expiry and cost. Enter moves to the next box." />
      <GrnWorkspace catalog={d.catalog} suppliers={d.sups.map((s) => ({ id: s.id, name: s.name, paymentTermsDays: s.paymentTermsDays }))} openPos={d.openPos}
        po={d.po ? { id: d.po.id, poNo: d.po.poNo, supplierId: d.po.supplierId } : null} initialLines={d.lines}
        today={localDay(ctx.tenant.timezone)} alertDays={Math.max(...ctx.tenant.expiryAlertDays, 30)} currency={ctx.tenant.currency} />
    </>
  );
}
