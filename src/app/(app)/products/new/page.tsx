import { PackagePlus } from "lucide-react";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { formOptions } from "../form-data";
import { ProductForm } from "../product-form";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const ctx = await requireCtx("products.write");
  const opts = await formOptions(ctx);
  return (
    <>
      <PageHeader title="Add a product" eyebrow="Catalogue" icon={<PackagePlus />} subtitle="Set up pack sizes once; the till, stock and orders all use them."
        actions={<LinkButton href="/products/import" variant="secondary">Import a list instead</LinkButton>} />
      <ProductForm d={{ schedule: "otc", baseUnit: "tablet" }} {...opts} />
    </>
  );
}
