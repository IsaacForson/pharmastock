import { eq } from "drizzle-orm";
import { ArrowLeft, Building2, Pencil, Siren, Trash2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { Badge, Dl, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { adminDb } from "@/db";
import { platformAdmins, recalls } from "@/db/schema";
import { COUNTRIES } from "@/lib/countries";
import { dateTime } from "@/lib/format";
import { requireAdmin } from "@/lib/platform-auth";
import { recallReach } from "@/lib/platform-metrics";
import { deleteRecallAction, saveRecallAction } from "../../actions";
import { RecallFields } from "../recall-fields";

export const metadata = { title: "Recall" };

export default async function RecallPage({ params }: PageProps<"/admin/recalls/[id]">) {
  await requireAdmin("recalls.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [row] = await adminDb().select({ r: recalls, by: platformAdmins.name }).from(recalls)
    .leftJoin(platformAdmins, eq(platformAdmins.id, recalls.createdBy)).where(eq(recalls.id, id));
  if (!row) notFound();
  const { r, by } = row;
  const reach = await recallReach(r);
  return (
    <>
      <div className="mb-4"><LinkButton href="/admin/recalls" variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" aria-hidden /> All recalls</LinkButton></div>
      <PageHeader eyebrow="Recall notice" icon={<Siren />} title={r.productName}
        subtitle={<span className="flex flex-wrap items-center gap-2">{r.batchNos.length ? <Badge tone="yellow">{r.batchNos.length} batch{r.batchNos.length === 1 ? "" : "es"}</Badge> : <Badge tone="red">All batches</Badge>}Published {r.publishedOn} · {r.country ? COUNTRIES[r.country]?.name ?? r.country : "all countries"}</span>} />
      <section className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Panel title="Notice" icon={<Siren />}>
            <Dl items={[
              ["Generic name", r.genericName], ["Manufacturer", r.manufacturer], ["Reason", r.reason], ["Source", r.source],
              ["Batches", r.batchNos.length ? <span key="b" className="font-mono text-xs">{r.batchNos.join(", ")}</span> : "Every batch"],
              ["Added", `${dateTime(r.createdAt, "UTC")}${by ? ` by ${by}` : ""}`],
            ]} />
          </Panel>
          <Panel title="Pharmacies holding matching stock" eyebrow="Live check · in stock now" icon={<Building2 />}>
            <Table head={["Pharmacy", "Batches", "Units"]} empty="No pharmacy currently holds matching stock.">
              {reach.map((p) => (
                <tr key={p.tenantId}>
                  <Td><Link href={`/admin/pharmacies/${p.tenantId}`} className="font-medium hover:text-accent">{p.name}</Link></Td>
                  <Td className="tabular-nums">{p.batches}</Td>
                  <Td className="tabular-nums">{p.units.toLocaleString()}</Td>
                </tr>
              ))}
            </Table>
            <p className="mt-3 text-xs text-subtle">Matched on product or generic name{r.batchNos.length ? " and batch number" : ""}. Pharmacies get a recall alert on the next nightly run.</p>
          </Panel>
        </div>
        <div className="space-y-4 xl:col-span-5">
          <Panel title="Edit notice" icon={<Pencil />}>
            <ActionForm action={saveRecallAction} className="space-y-4">
              <input type="hidden" name="id" value={r.id} />
              <RecallFields r={r} />
              <div className="flex justify-end"><Submit>Save changes</Submit></div>
            </ActionForm>
          </Panel>
          <Panel title="Withdraw notice" eyebrow="Published in error" icon={<Trash2 />}>
            <p className="mb-3 text-sm text-muted">Removes the notice. Alerts already raised in pharmacies stay until staff resolve them.</p>
            <ActionButton action={deleteRecallAction} fields={{ id: r.id }} variant="danger" confirm={`Withdraw the recall for ${r.productName}?`}>Withdraw recall</ActionButton>
          </Panel>
        </div>
      </section>
    </>
  );
}
