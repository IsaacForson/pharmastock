import { eq } from "drizzle-orm";
import { Bike } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { customers, sales } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { money, toMajor } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { createDeliveryAction } from "../actions";

export const metadata = { title: "New delivery" };

export default async function NewDeliveryPage({ searchParams }: PageProps<"/deliveries/new">) {
  const ctx = await requireCtx("deliveries.manage");
  if (!hasFeature(ctx.tenant, "delivery")) redirect("/settings/subscription");
  const sp = await searchParams;
  const saleId = typeof sp.sale === "string" && /^[0-9a-f-]{36}$/.test(sp.sale) ? sp.sale : null;
  if (!saleId) notFound();
  const d = await tx(ctx, async (t) => {
    const [s] = await t.select().from(sales).where(eq(sales.id, saleId));
    const [c] = s?.customerId ? await t.select().from(customers).where(eq(customers.id, s.customerId)) : [];
    return { s, c };
  });
  if (!d.s) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Deliver this order" eyebrow={d.s.saleNo} icon={<Bike />} subtitle={`${money(d.s.totalMinor, ctx.tenant.currency)}${d.c ? ` · ${d.c.name}` : ""}`} />
      <Panel>
        <ActionForm action={createDeliveryAction} onSuccessHref="/deliveries">
          <input type="hidden" name="saleId" value={d.s.id} />
          <Field label="Address"><Textarea name="address" rows={2} required defaultValue={d.c?.address ?? ""} placeholder="House, street, landmark" /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Phone"><Input name="phone" inputMode="tel" defaultValue={d.c?.phone ?? ""} /></Field>
            <Field label="Rider"><Input name="rider" /></Field>
            <Field label="Delivery fee"><Input name="fee" inputMode="decimal" defaultValue={toMajor(ctx.tenant.deliveryFeeMinor)} /></Field>
          </div>
          <Field label="Notes"><Input name="notes" placeholder="Gate code, call on arrival…" /></Field>
          <div className="flex justify-end"><Submit>Create delivery</Submit></div>
        </ActionForm>
      </Panel>
    </div>
  );
}
