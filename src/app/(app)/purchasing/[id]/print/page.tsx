import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/form";
import { A } from "@/components/ui";
import { branches, productUnits, products, purchaseOrderLines, purchaseOrders, suppliers } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateOnly, money } from "@/lib/format";
import { Letterhead, Sheet } from "../../letterhead";
import { PoDocument } from "../../po-document";

export const metadata = { title: "Print purchase order" };

export default async function PrintPoPage({ params }: PageProps<"/purchasing/[id]/print">) {
  const ctx = await requireCtx("purchasing.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tx(ctx, async (t) => {
    const [row] = await t.select({ po: purchaseOrders, s: suppliers, b: branches }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(branches, eq(branches.id, purchaseOrders.branchId)).where(eq(purchaseOrders.id, id));
    if (!row) return null;
    const lines = await t.select({ l: purchaseOrderLines, name: products.name, strength: products.strength, unit: productUnits.name })
      .from(purchaseOrderLines).innerJoin(products, eq(products.id, purchaseOrderLines.productId)).innerJoin(productUnits, eq(productUnits.id, purchaseOrderLines.unitId))
      .where(eq(purchaseOrderLines.poId, id)).orderBy(products.name);
    await audit(t, ctx, "print", "purchase_order", id);
    return { ...row, lines };
  });
  if (!d) notFound();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden"><A href={`/purchasing/${id}`}>← Back to order</A><PrintButton /></div>
      <Sheet>
        <Letterhead tenant={ctx.tenant} branch={d.b} title="Purchase order" number={d.po.poNo}>
          <div>Date {dateOnly(d.po.createdAt, ctx.tenant.timezone)}</div>
          {d.po.expectedAt && <div>Deliver by {dateOnly(d.po.expectedAt, "UTC")}</div>}
        </Letterhead>
        <PoDocument supplier={d.s} lines={d.lines.map(({ l, ...x }) => ({ ...x, qty: l.qty, unitCostMinor: l.unitCostMinor }))} totalMinor={d.po.totalMinor} notes={d.po.notes} fmt={(m) => money(m, ctx.tenant.currency)} />
      </Sheet>
    </div>
  );
}
