import { asc, eq } from "drizzle-orm";
import { FileUp } from "lucide-react";
import { LinkButton, PageHeader } from "@/components/ui";
import { suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { FIELDS } from "@/lib/import";
import { can } from "@/lib/permissions";
import { Importer } from "./importer";

export const metadata = { title: "Import products" };

export default async function ImportPage() {
  const ctx = await requireCtx("products.write");
  const sups = await tx(ctx, (t) => t.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)));
  return (
    <>
      <PageHeader title="Import products and prices" eyebrow="Catalogue" icon={<FileUp />}
        subtitle="Bring in a supplier price list or your current stock list. We match rows to your products and you check before anything is saved."
        actions={<LinkButton href="/products" variant="ghost">Back to products</LinkButton>} />
      <Importer fields={{ ...FIELDS }} suppliers={sups} canStock={can(ctx.user.role, "stock.receive")} canPrice={can(ctx.user.role, "prices.write")} currency={ctx.tenant.currency} />
    </>
  );
}
