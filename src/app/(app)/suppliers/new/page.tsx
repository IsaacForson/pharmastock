import { Truck } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "New supplier" };

export default async function NewSupplierPage() {
  await requireCtx("suppliers.manage");
  return (
    <>
      <PageHeader eyebrow="Suppliers" title="Add a supplier" icon={<Truck />} />
      <SupplierForm />
    </>
  );
}
