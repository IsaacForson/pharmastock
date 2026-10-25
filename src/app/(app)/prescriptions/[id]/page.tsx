import { desc, eq, inArray } from "drizzle-orm";
import { FileText, Paperclip, ScanLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/form";
import { A, Badge, Callout, Dl, EmptyState, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { customers, documents, prescriptionItems, prescriptions, products, sales, users } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { setPrescriptionStatusAction, verifyPrescriptionAction } from "../actions";

export const metadata = { title: "Prescription" };

const UPLOAD_ERRORS: Record<string, string> = {
  plan: "Prescriptions need the Pro plan.", empty: "Choose a file to upload.", size: "That file is too big (15 MB max).",
  type: "Upload a photo or a PDF.", auth: "You can't upload documents with this account right now.",
};

export default async function PrescriptionPage({ params, searchParams }: PageProps<"/prescriptions/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx("prescriptions.read");
  if (!/^[0-9a-f-]{36}$/.test(id) || !hasFeature(ctx.tenant, "prescriptions")) notFound();
  const tz = ctx.tenant.timezone, role = ctx.user.role;
  const d = await tx(ctx, async (t) => {
    const [rx] = await t.select().from(prescriptions).where(eq(prescriptions.id, id));
    if (!rx) return null;
    const [c] = await t.select().from(customers).where(eq(customers.id, rx.customerId));
    const items = await t.select({ i: prescriptionItems, product: products.name, strength: products.strength }).from(prescriptionItems)
      .leftJoin(products, eq(products.id, prescriptionItems.productId)).where(eq(prescriptionItems.prescriptionId, id));
    const fills = await t.select({ s: sales, by: users.name }).from(sales).leftJoin(users, eq(users.id, sales.pharmacistId)).where(eq(sales.prescriptionId, id)).orderBy(desc(sales.soldAt));
    const docs = await t.select().from(documents).where(eq(documents.entityId, id)).orderBy(desc(documents.createdAt));
    const people = [rx.verifiedBy, rx.createdBy].filter(Boolean) as string[];
    const staff = people.length ? await t.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, people)) : [];
    await audit(t, ctx, "view", "prescription", id, { customerId: rx.customerId });
    return { rx, c, items, fills, docs: docs.filter((x) => x.entity === "prescription"), staff };
  });
  if (!d) notFound();
  const { rx, c } = d;
  const write = ctx.access === "full" && can(role, "prescriptions.write");
  const name = (u: string | null) => d.staff.find((s) => s.id === u)?.name ?? "—";
  const fillsLeft = rx.refillsAllowed + 1 - rx.refillsUsed;

  return (
    <div>
      <PageHeader title={<span className="font-mono">{rx.rxNo}</span>} eyebrow="Prescription" icon={<FileText />}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Link href={`/customers/${c.id}`} className="text-accent hover:underline">{c.name}</Link> · {rx.prescriberName} · issued {rx.issuedOn} <Badge tone={rx.status === "active" ? "green" : "gray"}>{rx.status}</Badge>{rx.verifiedBy ? <Badge tone="green">verified</Badge> : <Badge tone="yellow">not verified</Badge>}</span>}
        actions={rx.status === "active" && can(role, "pos.sell") && ctx.access === "full" && <LinkButton href={`/pos?rx=${rx.id}`} size="lg"><ScanLine className="h-4 w-4" aria-hidden /> Dispense</LinkButton>} />
      {sp.uploaded === "1" && <div className="mb-4"><Callout tone="green">Document attached.</Callout></div>}
      {typeof sp.error === "string" && UPLOAD_ERRORS[sp.error] && <div className="mb-4"><Callout tone="red">{UPLOAD_ERRORS[sp.error]}</Callout></div>}
      {c.allergies && <div className="mb-4"><Callout tone="red"><strong>Allergies:</strong> {c.allergies}</Callout></div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Medicines" bodyClassName="p-0">
            <Table head={["As written", "Our product", "Dose", "Per fill", "Dispensed", "Directions"]}>
              {d.items.map(({ i, product, strength }) => (
                <tr key={i.id}>
                  <Td className="whitespace-normal font-medium">{i.drugName}</Td>
                  <Td className="whitespace-normal">{product ? `${product} ${strength ?? ""}` : <Badge tone="yellow">not matched</Badge>}</Td>
                  <Td className="whitespace-normal text-muted">{[i.dose, i.frequency, i.duration].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td className="tabular-nums">{i.qtyPrescribed || "—"}</Td>
                  <Td className="tabular-nums">{i.qtyDispensed}</Td>
                  <Td className="whitespace-normal text-muted">{i.directions ?? "—"}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Fills" bodyClassName="p-0">
            <Table head={["Sale", "When", "Pharmacist", "Total", "Status"]} empty={<EmptyState title="Not dispensed yet" compact>Press Dispense to fill it at the till.</EmptyState>}>
              {d.fills.map(({ s, by }) => (
                <tr key={s.id}><Td><A href={`/sales/${s.id}`} className="font-mono text-xs">{s.saleNo}</A></Td><Td className="text-muted">{dateTime(s.soldAt, tz)}</Td><Td>{by ?? "—"}</Td><Td className="tabular-nums">{money(s.totalMinor, ctx.tenant.currency)}</Td><Td><Badge tone={s.status === "voided" ? "red" : "green"}>{s.status.replace("_", " ")}</Badge></Td></tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Paper prescription" icon={<Paperclip />}>
            {d.docs.length ? (
              <ul className="mb-4 divide-y divide-line text-sm">
                {d.docs.map((doc) => <li key={doc.id} className="flex justify-between gap-3 py-2"><a href={`/prescriptions/${rx.id}/file?doc=${doc.id}`} target="_blank" rel="noopener" className="text-accent hover:underline">{doc.name}</a><span className="text-xs text-muted">{dateTime(doc.createdAt, tz)}</span></li>)}
              </ul>
            ) : <p className="mb-4 text-sm text-muted">No photo or scan attached.</p>}
            {write && (
              <form action={`/prescriptions/${rx.id}/file`} method="post" encType="multipart/form-data" className="flex flex-wrap items-center gap-2">
                <input type="file" name="file" accept="image/*,application/pdf" capture="environment" required className="text-sm text-muted file:mr-3 file:h-9 file:rounded file:border file:border-line file:bg-surface-2 file:px-3 file:text-sm file:text-fg" />
                <button className="h-9 rounded border border-line bg-surface-2 px-3 text-sm font-medium text-fg hover:bg-surface-3">Upload</button>
              </form>
            )}
          </Panel>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Details">
            <Dl cols={1} items={[
              ["Prescriber", `${rx.prescriberName}${rx.prescriberRegNo ? ` (${rx.prescriberRegNo})` : ""}`], ["Facility", rx.facility ?? "—"],
              ["Fills", `${rx.refillsUsed} used · ${Math.max(0, fillsLeft)} left`], ["Refill every", rx.refillIntervalDays ? `${rx.refillIntervalDays} days` : "—"],
              ["Next refill", rx.nextRefillDue ?? "—"], ["Diagnosis", rx.diagnosis || "—"], ["Notes", rx.notes || "—"],
              ["Recorded by", name(rx.createdBy)], ["Verified by", name(rx.verifiedBy)],
            ]} />
          </Panel>
          {write && (
            <Panel title="Actions">
              <div className="flex flex-wrap gap-2">
                {!rx.verifiedBy && can(role, "sell.pharmacy") && <ActionButton action={verifyPrescriptionAction} fields={{ id: rx.id }} variant="primary"><ShieldCheck className="h-4 w-4" aria-hidden /> Verify</ActionButton>}
                {rx.status === "active" && <>
                  <ActionButton action={setPrescriptionStatusAction} fields={{ id: rx.id, status: "completed" }}>Mark completed</ActionButton>
                  <ActionButton action={setPrescriptionStatusAction} fields={{ id: rx.id, status: "cancelled" }} variant="danger" confirm="Cancel this prescription?">Cancel</ActionButton>
                </>}
                {rx.status !== "active" && <ActionButton action={setPrescriptionStatusAction} fields={{ id: rx.id, status: "active" }}>Reactivate</ActionButton>}
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
