import { and, desc, eq, isNull } from "drizzle-orm";
import { FilePlus2 } from "lucide-react";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input, PageHeader, Panel, Textarea } from "@/components/ui";
import { customers, products } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { createPrescriptionAction } from "../actions";
import { RxItems } from "../rx-items";

export const metadata = { title: "New prescription" };

export default async function NewPrescriptionPage({ searchParams }: PageProps<"/prescriptions/new">) {
  const ctx = await requireCtx("prescriptions.write");
  if (!hasFeature(ctx.tenant, "prescriptions")) redirect("/settings/subscription");
  const sp = await searchParams;
  const cid = typeof sp.customer === "string" && /^[0-9a-f-]{36}$/.test(sp.customer) ? sp.customer : null;
  const d = await tx(ctx, async (t) => ({
    picked: cid ? (await t.select({ no: customers.customerNo, name: customers.name }).from(customers).where(eq(customers.id, cid)))[0] : undefined,
    people: await t.select({ no: customers.customerNo, name: customers.name }).from(customers).where(isNull(customers.deletedAt)).orderBy(desc(customers.createdAt)).limit(2000),
    prods: await t.select({ name: products.name, strength: products.strength }).from(products).where(and(eq(products.active, true))).orderBy(products.name).limit(5000),
  }));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="New prescription" eyebrow="Prescriptions" icon={<FilePlus2 />} subtitle="Record the paper prescription. You can add a photo of it on the next screen." />
      <ActionForm action={createPrescriptionAction} onSuccessHref="/prescriptions/{id}" className="space-y-4">
        <Panel title="Prescription" eyebrow="From">
          <datalist id="rx-customers">{d.people.map((c) => <option key={c.no} value={`${c.no} · ${c.name}`} />)}</datalist>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Customer" hint="Type a name or customer number"><Input name="customer" list="rx-customers" required defaultValue={d.picked ? `${d.picked.no} · ${d.picked.name}` : ""} /></Field>
            <Field label="Prescriber"><Input name="prescriberName" required placeholder="Dr A. Mensah" /></Field>
            <Field label="Prescriber reg. no."><Input name="prescriberRegNo" /></Field>
            <Field label="Facility"><Input name="facility" placeholder="Hospital or clinic" /></Field>
            <Field label="Issued on"><Input name="issuedOn" type="date" required defaultValue={localDay(ctx.tenant.timezone)} /></Field>
            <Field label="Repeats allowed" hint="0 = fill once"><Input name="refillsAllowed" type="number" min={0} max={24} defaultValue={0} /></Field>
            <Field label="Refill every (days)" hint="For chronic medicines: reminders"><Input name="refillIntervalDays" type="number" min={1} max={365} /></Field>
            <Field label="Diagnosis" hint="Stored encrypted" className="lg:col-span-2"><Input name="diagnosis" /></Field>
            <Field label="Notes" hint="Stored encrypted" className="sm:col-span-2 lg:col-span-3"><Textarea name="notes" rows={2} /></Field>
          </div>
        </Panel>
        <Panel title="Medicines" eyebrow="Items">
          <RxItems products={d.prods.map((p) => [p.name, p.strength].filter(Boolean).join(" "))} />
        </Panel>
        <div className="flex justify-end"><Submit size="lg">Save prescription</Submit></div>
      </ActionForm>
    </div>
  );
}
