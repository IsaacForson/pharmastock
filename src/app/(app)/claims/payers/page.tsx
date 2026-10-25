import { asc } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { A, Badge, Check, EmptyState, Field, Input, PageHeader, Panel, Select, Table, Td } from "@/components/ui";
import { payers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { hasFeature } from "@/lib/plans";
import { savePayerAction } from "../actions";

export const metadata = { title: "Payers" };
const KIND: Record<string, string> = { insurer: "Insurer", hmo: "HMO", corporate: "Company account", nhis: "National scheme" };
type Payer = typeof payers.$inferSelect;

function PayerForm({ p }: { p?: Payer }) {
  return (
    <ActionForm action={savePayerAction} resetOnSuccess={!p}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input name="name" required defaultValue={p?.name} /></Field>
        <Field label="Type"><Select name="kind" defaultValue={p?.kind ?? "insurer"}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Share they cover (%)" hint="The rest is paid by the customer"><Input name="coverage" type="number" min={0} max={100} step="0.01" required defaultValue={p ? p.coverageBp / 100 : 100} /></Field>
        <Field label="Code"><Input name="code" defaultValue={p?.code ?? ""} /></Field>
        <Field label="Contact"><Input name="contactName" defaultValue={p?.contactName ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={p?.phone ?? ""} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={p?.email ?? ""} /></Field>
        {p && <Check name="active" label="Active" defaultChecked={p.active} className="self-end pb-2" />}
      </div>
      <Submit>{p ? "Save" : "Add payer"}</Submit>
    </ActionForm>
  );
}

export default async function PayersPage({ searchParams }: PageProps<"/claims/payers">) {
  const ctx = await requireCtx("claims.manage");
  if (!hasFeature(ctx.tenant, "claims")) redirect("/settings/subscription");
  const edit = (await searchParams).edit;
  const rows = await tx(ctx, (t) => t.select().from(payers).orderBy(asc(payers.name)));
  const editing = rows.find((p) => p.id === edit);
  return (
    <div>
      <PageHeader title="Payers" eyebrow="Insurance claims" icon={<Building2 />} subtitle="Insurers, HMOs and companies that pay part of a customer's bill." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Panel bodyClassName="p-0">
          <Table head={["Payer", "Type", "Covers", "Contact", ""]} empty={<EmptyState title="No payers yet" compact>Add the insurers and HMOs your customers use.</EmptyState>}>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.name}{!p.active && <> <Badge>inactive</Badge></>}</Td><Td className="text-muted">{KIND[p.kind] ?? p.kind}</Td>
                <Td className="tabular-nums">{p.coverageBp / 100}%</Td><Td className="text-muted">{[p.contactName, p.phone, p.email].filter(Boolean).join(" · ") || "—"}</Td>
                <Td>{ctx.access === "full" && <A href={`/claims/payers?edit=${p.id}`}>Edit</A>}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
        {ctx.access === "full" && (
          <Panel title={editing ? `Edit ${editing.name}` : "Add a payer"} glow>
            <PayerForm key={editing?.id ?? "new"} p={editing} />
          </Panel>
        )}
      </div>
    </div>
  );
}
