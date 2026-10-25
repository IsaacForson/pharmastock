import { asc, eq } from "drizzle-orm";
import { ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { loadCatalog } from "../catalog";
import { PoEditor } from "../po-editor";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage({ searchParams }: PageProps<"/purchasing/new">) {
  const ctx = await requireCtx("purchasing.manage");
  const sp = await searchParams;
  const { catalog, sups } = await tx(ctx, async (t) => ({
    catalog: await loadCatalog(t, { branchId: ctx.branchId }),
    sups: await t.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  }));
  const supplierId = typeof sp.supplier === "string" && sups.some((s) => s.id === sp.supplier) ? sp.supplier : "";
  return (
    <>
      <PageHeader eyebrow="Purchasing" title="New purchase order" icon={<ShoppingCart />} subtitle="Scan or search products. Costs fill in from the supplier's last price." />
      <PoEditor catalog={catalog} suppliers={sups} currency={ctx.tenant.currency} initial={{ supplierId }} />
    </>
  );
}
