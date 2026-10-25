import { Activity, AlertTriangle, MessageSquareWarning, RotateCcw, Timer, Webhook } from "lucide-react";
import Link from "next/link";
import { ActionButton } from "@/components/form";
import { Badge, Kpi, PageHeader, Panel, Table, Td } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { requireAdmin } from "@/lib/platform-auth";
import { systemHealth } from "@/lib/platform-metrics";
import { retryJobAction } from "../actions";

export const metadata = { title: "System health" };

export default async function SystemPage() {
  await requireAdmin("system.jobs");
  const h = await systemHealth();
  const count = (s: string) => h.jobs.filter((j) => j.status === s).reduce((n, j) => n + j.n, 0);
  const healthy = count("failed") === 0 && h.backlog.overdue === 0;
  return (
    <>
      <PageHeader eyebrow="Operations" icon={<Activity />} title="System health" subtitle="Background jobs (reminders, messages, exports, webhooks), delivery failures and the worker backlog."
        actions={<Badge tone={healthy ? "green" : "red"} pulse>{healthy ? "All systems normal" : "Needs attention"}</Badge>} />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Pending jobs" value={count("pending")} sub={`${count("running")} running now`} icon={<Timer />} tone="blue" />
        <Kpi label="Overdue" value={h.backlog.overdue} sub={h.backlog.oldest ? `oldest due ${dateTime(h.backlog.oldest, "UTC")}` : "worker is keeping up"} icon={<AlertTriangle />} tone={h.backlog.overdue ? "red" : "green"} />
        <Kpi label="Failed jobs" value={count("failed")} sub="after 5 attempts" icon={<AlertTriangle />} tone={count("failed") ? "red" : "green"} />
        <Kpi label="Webhook deliveries" value={h.hooks.failed} sub={`failed · ${h.hooks.pending} retrying`} icon={<Webhook />} tone={h.hooks.failed ? "yellow" : "green"} />
      </section>
      <section className="mt-6 grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Panel title="Failed jobs" icon={<AlertTriangle />} actions={count("failed") > 0 && <ActionButton action={retryJobAction} fields={{}} confirm="Queue every failed job again?"><RotateCcw className="h-3.5 w-3.5" />Retry all</ActionButton>}>
            <Table head={["Type", "Pharmacy", "Attempts", "Last error", "Due", ""]} empty="No failed jobs. 🎉">
              {h.failedJobs.map((j) => (
                <tr key={j.id}>
                  <Td className="font-mono text-xs">{j.type}</Td>
                  <Td>{j.tenantId ? <Link href={`/admin/pharmacies/${j.tenantId}`} className="hover:text-accent">{j.pharmacy ?? "—"}</Link> : "platform"}</Td>
                  <Td className="tabular-nums">{j.attempts}</Td>
                  <Td className="max-w-sm truncate text-xs text-bad" title={j.lastError ?? ""}>{j.lastError}</Td>
                  <Td className="text-muted">{dateTime(j.runAt, "UTC")}</Td>
                  <Td><ActionButton action={retryJobAction} fields={{ id: j.id }}>Retry</ActionButton></Td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Jobs by type" icon={<Timer />}>
            <Table head={["Type", "Status", "Count"]} empty="The queue is empty.">
              {h.jobs.map((j) => <tr key={`${j.type}-${j.status}`}><Td className="font-mono text-xs">{j.type}</Td><Td><Badge tone={j.status === "done" ? "green" : j.status === "failed" ? "red" : j.status === "running" ? "blue" : "gray"}>{j.status}</Badge></Td><Td className="tabular-nums">{j.n}</Td></tr>)}
            </Table>
          </Panel>
        </div>
        <div className="xl:col-span-4">
          <Panel title="Message failures" eyebrow="Last 7 days" icon={<MessageSquareWarning />}>
            <Table head={["Reason", "Count"]} empty="No failed messages.">
              {h.msgFailures.map((m) => <tr key={m.error}><Td className="max-w-[16rem] truncate text-xs" title={m.error ?? ""}>{m.error}</Td><Td className="tabular-nums">{m.n}</Td></tr>)}
            </Table>
          </Panel>
        </div>
      </section>
    </>
  );
}
