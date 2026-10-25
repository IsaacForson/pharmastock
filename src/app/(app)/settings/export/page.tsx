import { desc, eq } from "drizzle-orm";
import { Download, FileJson, FileSpreadsheet, HardDriveDownload, History, Lock, Paperclip } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { Badge, EmptyState, Panel, Table, Td } from "@/components/ui";
import { exportJobs, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { requestExportAction } from "./actions";


export const metadata = { title: "Export" };
const TONE = { pending: "gray", running: "blue", done: "green", failed: "red" } as const;

export default async function ExportPage() {
  const ctx = await requireCtx("export");
  const jobs = await tx(ctx, (t) => t.select({ j: exportJobs, by: users.name }).from(exportJobs).leftJoin(users, eq(users.id, exportJobs.requestedBy)).orderBy(desc(exportJobs.createdAt)).limit(20));
  return (
    <>
      <section className="glass ring-aurora relative overflow-hidden p-6 animate-rise sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-aurora opacity-20 blur-3xl" aria-hidden />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Free on every plan</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Export all your data</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              One file with everything: products and prices, batches and stock movements, sales and payments, customers, prescriptions, purchase orders and deliveries, suppliers, the controlled-drug register, expenses, messages, audit log and uploaded documents —
              as JSON plus spreadsheet-ready CSV files. Available even if your subscription has lapsed.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
              {[[<FileJson key="j" />, "JSON"], [<FileSpreadsheet key="c" />, "CSV"], [<Paperclip key="p" />, "Documents"]].map(([i, l]) => (
                <span key={l as string} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-accent">{i}{l}</span>
              ))}
            </div>
          </div>
          <ActionForm action={requestExportAction} className="lg:w-64">
            <Submit size="lg" className="w-full"><HardDriveDownload className="h-4 w-4" aria-hidden /> Request full export</Submit>
            <p className="flex items-center gap-1.5 text-xs text-warn"><Lock className="h-3 w-3" aria-hidden />Contains decrypted customer and prescription records. Store it securely.</p>
          </ActionForm>
        </div>
      </section>

      <Panel title="Past exports" eyebrow="Last 20" icon={<History />}>
        {jobs.length === 0 ? <EmptyState compact icon={<HardDriveDownload />} title="No exports yet">Your first export usually takes a few minutes. It appears here when ready.</EmptyState> : (
          <Table head={["Requested", "By", "Status", "Ready", ""]}>
            {jobs.map(({ j, by }) => (
              <tr key={j.id}>
                <Td className="tabular-nums">{dateTime(j.createdAt, ctx.tenant.timezone)}</Td>
                <Td className="text-muted">{by}</Td>
                <Td><Badge tone={TONE[j.status as keyof typeof TONE] ?? "gray"} pulse={j.status === "running"}>{j.status}</Badge> {j.error && <span className="ml-1 text-xs text-bad">{j.error}</span>}</Td>
                <Td className="text-muted tabular-nums">{dateTime(j.completedAt, ctx.tenant.timezone)}</Td>
                <Td className="text-right">{j.status === "done" && j.storageKey && (ctx.user.role === "owner"
                  ? <a href={`/api/exports/${j.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-xs font-medium text-fg transition hover:bg-surface-3"><Download className="h-3.5 w-3.5" aria-hidden />Download .zip</a>
                  : <span className="text-xs text-subtle">Owner can download</span>)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
