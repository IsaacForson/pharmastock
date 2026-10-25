import { asc, eq } from "drizzle-orm";
import { ShoppingCart } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { purchaseOrderLines, purchaseOrders, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { loadCatalog } from "../../catalog";
import { PoEditor } from "../../po-editor";

export const metadata = { title: "Edit purchase order" };

export default async function EditPoPage({ params }: PageProps<"/purchasing/[id]/edit">) {
  const ctx = await requireCtx("purchasing.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await tx(ctx, async (t) => {
    const [po] = await t.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!po) return null;
    return {
      po, lines: await t.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id)),
      catalog: await loadCatalog(t, { branchId: po.branchId }),
      sups: await t.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
    };
  });
  if (!data) notFound();
  if (data.po.status !== "draft" && data.po.status !== "sent") redirect(`/purchasing/${id}`);
  return (
    <>
      <PageHeader eyebrow={data.po.poNo} title="Edit purchase order" icon={<ShoppingCart />} subtitle={data.po.status === "sent" ? "This order was already sent. Send it again after saving so the supplier sees the changes." : undefined} />
      <PoEditor catalog={data.catalog} suppliers={data.sups} currency={ctx.tenant.currency}
        initial={{ id, supplierId: data.po.supplierId, notes: data.po.notes, expectedAt: data.po.expectedAt, lines: data.lines }} />
    </>
  );
}
