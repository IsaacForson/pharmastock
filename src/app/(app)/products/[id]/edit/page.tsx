import { eq, inArray } from "drizzle-orm";
import { Pencil } from "lucide-react";
import { notFound } from "next/navigation";
import { LinkButton, PageHeader } from "@/components/ui";
import { barcodes, productUnits, products } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { formOptions } from "../../form-data";
import { ProductForm } from "../../product-form";

export const metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: PageProps<"/products/[id]/edit">) {
  const ctx = await requireCtx("products.write");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await tx(ctx, async (t) => {
    const [p] = await t.select().from(products).where(eq(products.id, id));
    if (!p) return null;
    const units = await t.select().from(productUnits).where(eq(productUnits.productId, id)).orderBy(productUnits.factor);
    const codes = units.length ? await t.select().from(barcodes).where(inArray(barcodes.unitId, units.map((u) => u.id))) : [];
    return { p, units: units.map((u) => ({ ...u, barcodes: codes.filter((c) => c.unitId === u.id).map((c) => c.code) })) };
  });
  if (!data) notFound();
  const opts = await formOptions(ctx);
  return (
    <>
      <PageHeader title={`Edit ${data.p.name}`} eyebrow="Catalogue" icon={<Pencil />} actions={<LinkButton href={`/products/${id}`} variant="ghost">Cancel</LinkButton>} />
      <ProductForm d={{ ...data.p, units: data.units }} {...opts} />
    </>
  );
}
