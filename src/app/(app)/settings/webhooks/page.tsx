import { desc, eq } from "drizzle-orm";
import { Activity, Plus, ShieldCheck, Webhook } from "lucide-react";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { Badge, Check, EmptyState, Field, Input, Panel, StatusDot, Table, Td } from "@/components/ui";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { WEBHOOK_EVENTS } from "@/lib/events";
import { dateTime } from "@/lib/format";
import { SecretActionForm } from "../secret-form";
import { createWebhookAction, deleteWebhookAction, testWebhookAction, updateWebhookAction } from "./actions";


export const metadata = { title: "Webhooks" };
function EventBoxes({ selected }: { selected?: string[] }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium tracking-wide text-muted">Events</legend>
      <div className="flex flex-wrap gap-2">
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e} className="inline-flex cursor-pointer items-center gap-2 rounded border border-line bg-surface px-2.5 py-1.5 transition hover:border-line-strong has-[:checked]:border-accent/40 has-[:checked]:bg-accent/10">
            <input type="checkbox" name="events" value={e} defaultChecked={selected?.includes(e)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            <code className="font-mono text-xs text-fg">{e}</code>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function WebhooksPage() {
  const ctx = await requireCtx("api.manage");
  const [hooks, deliveries] = await tx(ctx, async (t) => [
    await t.select({ id: webhooks.id, url: webhooks.url, events: webhooks.events, active: webhooks.active }).from(webhooks).orderBy(desc(webhooks.createdAt)),
    await t.select({ d: webhookDeliveries, url: webhooks.url }).from(webhookDeliveries).innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .orderBy(desc(webhookDeliveries.createdAt)).limit(30),
  ] as const);
  return (
    <>
      <div className="sheet flex flex-wrap items-center gap-4 p-5">
        <span className="grid h-11 w-11 place-items-center rounded-md border border-accent/25 bg-accent/15 text-accent" aria-hidden><ShieldCheck className="h-5 w-5" /></span>
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-muted">PharmaStock POSTs JSON to your URL when these events happen. Verify the <code className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-accent-2">X-PharmaStock-Signature</code> header (HMAC-SHA256 of the body with your signing secret).</p>
      </div>

      {hooks.length === 0 && <EmptyState icon={<Webhook />} title="No webhooks yet">Add an endpoint below to receive sales, stock, purchase order and alert events in real time.</EmptyState>}
      {hooks.map((h) => (
        <Panel key={h.id} icon={<Webhook />} title={<span className="font-mono text-sm">{h.url}</span>}
          eyebrow={<span className="inline-flex items-center gap-1.5"><StatusDot tone={h.active ? "green" : "gray"} pulse={h.active} />{h.active ? `Live · ${h.events.length} events` : "Paused"}</span>}
          actions={<>
            <ActionButton action={testWebhookAction} fields={{ id: h.id }}>Send test</ActionButton>
            <ActionButton action={deleteWebhookAction} fields={{ id: h.id }} variant="danger" confirm="Delete this webhook?">Delete</ActionButton>
          </>}>
          <ActionForm action={updateWebhookAction} className="space-y-4">
            <input type="hidden" name="id" value={h.id} />
            <Field label="URL"><Input name="url" type="url" defaultValue={h.url} required className="font-mono" /></Field>
            <EventBoxes selected={h.events} />
            <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
              <Check name="active" defaultChecked={h.active} label="Active" />
              <Submit variant="secondary">Save</Submit>
            </div>
          </ActionForm>
        </Panel>
      ))}

      <Panel title="Add a webhook" eyebrow="New endpoint" icon={<Plus />} glow>
        <SecretActionForm action={createWebhookAction} resetOnSuccess>
          <Field label="URL"><Input name="url" type="url" required placeholder="https://example.com/pharmastock" className="font-mono" /></Field>
          <EventBoxes />
          <div className="flex justify-end"><Submit>Add webhook</Submit></div>
        </SecretActionForm>
      </Panel>

      <Panel title="Recent deliveries" eyebrow="Last 30" icon={<Activity />}>
        {deliveries.length === 0 ? <EmptyState compact icon={<Activity />} title="No deliveries yet">Use “Send test” on a webhook to check your endpoint.</EmptyState> : (
          <Table head={["Time", "Event", "URL", "Status", "Response", "Attempts"]}>
            {deliveries.map(({ d, url }) => (
              <tr key={d.id}>
                <Td className="text-muted tabular-nums">{dateTime(d.createdAt, ctx.tenant.timezone)}</Td>
                <Td><code className="font-mono text-xs">{d.event}</code></Td>
                <Td className="max-w-xs truncate font-mono text-xs text-muted">{url}</Td>
                <Td><Badge tone={d.status === "delivered" || d.status === "done" ? "green" : d.status === "failed" ? "red" : "gray"}>{d.status}</Badge></Td>
                <Td className="font-mono text-xs tabular-nums">{d.responseCode}</Td>
                <Td className="tabular-nums">{d.attempts}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
