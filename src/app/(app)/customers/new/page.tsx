import { eq } from "drizzle-orm";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { payers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const ctx = await requireCtx("customers.write");
  const list = await tx(ctx, (t) => t.select({ id: payers.id, name: payers.name }).from(payers).where(eq(payers.active, true)).orderBy(payers.name));
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New customer" eyebrow="Customers" icon={<UserPlus />} />
      <CustomerForm payers={list} canLimit={can(ctx.user.role, "settings.manage")} />
    </div>
  );
}
