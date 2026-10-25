import { desc } from "drizzle-orm";
import { Plus, Siren } from "lucide-react";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { Badge, PageHeader, Panel, Table, Td } from "@/components/ui";
import { adminDb } from "@/db";
import { recalls } from "@/db/schema";
import { COUNTRIES } from "@/lib/countries";
import { requireAdmin } from "@/lib/platform-auth";
import { saveRecallAction } from "../actions";
import { RecallFields } from "./recall-fields";

export const metadata = { title: "Recalls" };

export default async function RecallsPage() {
  await requireAdmin("recalls.manage");
  const rows = await adminDb().select().from(recalls).orderBy(desc(recalls.publishedOn), desc(recalls.createdAt)).limit(300);
  return (
    <>
      <PageHeader eyebrow="Safety" icon={<Siren />} title="Recall notices"
        subtitle="Platform-wide recalls from regulator notices. Every night each pharmacy's batches are checked against these and matching stock is flagged and blocked at the till." />
      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Panel title="Published recalls" eyebrow={`${rows.length} notice${rows.length === 1 ? "" : "s"}`} icon={<Siren />}>
            <Table head={["Published", "Product", "Batches", "Country", "Source"]} empty="No recall notices yet.">
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="tabular-nums text-muted">{r.publishedOn}</Td>
                  <Td>
                    <Link href={`/admin/recalls/${r.id}`} className="font-medium hover:text-accent">{r.productName}</Link>
                    <span className="block text-xs text-subtle">{[r.genericName, r.manufacturer].filter(Boolean).join(" · ")}</span>
                  </Td>
                  <Td>{r.batchNos.length ? <span className="font-mono text-xs">{r.batchNos.slice(0, 3).join(", ")}{r.batchNos.length > 3 ? ` +${r.batchNos.length - 3}` : ""}</span> : <Badge tone="red">All batches</Badge>}</Td>
                  <Td>{r.country ? COUNTRIES[r.country]?.name ?? r.country : <span className="text-subtle">All</span>}</Td>
                  <Td className="max-w-48 truncate text-xs text-muted">{r.source}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
        <div className="xl:col-span-5">
          <Panel title="Publish a recall" eyebrow="New notice" icon={<Plus />} glow>
            <ActionForm action={saveRecallAction} onSuccessHref="/admin/recalls/{id}" className="space-y-4">
              <RecallFields />
              <p className="text-xs text-subtle">Double-check batch numbers against the regulator&apos;s notice: matching stock becomes unsellable in every pharmacy that holds it.</p>
              <div className="flex justify-end"><Submit>Publish recall</Submit></div>
            </ActionForm>
          </Panel>
        </div>
      </section>
    </>
  );
}
