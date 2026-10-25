import { asc, eq } from "drizzle-orm";
import { FilePlus2 } from "lucide-react";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input, PageHeader, Panel, Select } from "@/components/ui";
import { payers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { createClaimAction } from "../actions";

export const metadata = { title: "New claim" };

export default async function NewClaimPage({ searchParams }: PageProps<"/claims/new">) {
  const ctx = await requireCtx("claims.manage");
  if (!hasFeature(ctx.tenant, "claims")) redirect("/settings/subscription");
  const sp = await searchParams;
  const list = await tx(ctx, (t) => t.select({ id: payers.id, name: payers.name }).from(payers).where(eq(payers.active, true)).orderBy(asc(payers.name)));
  const today = localDay(ctx.tenant.timezone);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New claim" eyebrow="Insurance claims" icon={<FilePlus2 />} subtitle="Every unclaimed sale for the payer in the period goes into one claim batch." />
      <Panel>
        <ActionForm action={createClaimAction} onSuccessHref="/claims/{id}">
          <Field label="Payer"><Select name="payerId" required defaultValue={typeof sp.payer === "string" ? sp.payer : ""}><option value="" disabled>Choose…</option>{list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From"><Input type="date" name="from" required defaultValue={`${today.slice(0, 8)}01`} max={today} /></Field>
            <Field label="To"><Input type="date" name="to" required defaultValue={today} max={today} /></Field>
          </div>
          <div className="flex justify-end"><Submit>Create draft claim</Submit></div>
        </ActionForm>
      </Panel>
    </div>
  );
}
