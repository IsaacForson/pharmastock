import { eq } from "drizzle-orm";
import { Truck } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { SupplierForm } from "../../supplier-form";

export const metadata = { title: "Edit supplier" };

export default async function EditSupplierPage({ params }: PageProps<"/suppliers/[id]/edit">) {
  const ctx = await requireCtx("suppliers.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [s] = await tx(ctx, (t) => t.select().from(suppliers).where(eq(suppliers.id, id)));
  if (!s) notFound();
  return (
    <>
      <PageHeader eyebrow="Suppliers" title={`Edit ${s.name}`} icon={<Truck />} />
      <SupplierForm s={s} />
    </>
  );
}
