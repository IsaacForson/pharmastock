import { eq } from "drizzle-orm";
import { UserPen } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { customers, payers } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CustomerForm } from "../../customer-form";

export const metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: PageProps<"/customers/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireCtx("customers.write");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tx(ctx, async (t) => {
    const [c] = await t.select().from(customers).where(eq(customers.id, id));
    if (c) await audit(t, ctx, "view", "customer", c.id, { customerId: c.id, details: { via: "edit" } });
    return { c, list: await t.select({ id: payers.id, name: payers.name }).from(payers).where(eq(payers.active, true)).orderBy(payers.name) };
  });
  if (!d.c || d.c.deletedAt) notFound();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={d.c.name} eyebrow="Edit customer" icon={<UserPen />} />
      <CustomerForm c={d.c} payers={d.list} canLimit={can(ctx.user.role, "settings.manage")} />
    </div>
  );
}
