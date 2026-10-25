import { ArrowLeftRight, Printer, Undo2 } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { Badge, Callout, Dl, Field, Input, LinkButton, PageHeader, Panel, Table, Td, Textarea } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { cancelTransferAction, receiveTransferAction } from "../actions";
import { ChainOnly } from "../chain-only";
import { loadTransfer } from "./data";

export const metadata = { title: "Transfer" };
const TONE = { in_transit: "yellow", received: "green", cancelled: "gray" } as const;

export default async function TransferPage({ params }: PageProps<"/transfers/[id]">) {
  const ctx = await requireCtx("stock.transfer");
  if (!hasFeature(ctx.tenant, "transfers")) return <ChainOnly />;
  const d = await loadTransfer(ctx, (await params).id);
  const { tr } = d;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const open = tr.status === "in_transit";
  const canReceive = open && tr.toBranchId === ctx.branchId;
  const canCancel = open && tr.fromBranchId === ctx.branchId;
  const value = d.lines.reduce((s, x) => s + x.l.qty * x.cost, 0);

  return (
    <>
      <PageHeader title={<span className="font-mono">{tr.transferNo}</span>} eyebrow="Transfer" icon={<ArrowLeftRight />}
        subtitle={`${d.fromName} → ${d.toName}`}
        actions={<>
          <Badge tone={TONE[tr.status as keyof typeof TONE] ?? "gray"}>{tr.status.replace("_", " ")}</Badge>
          <LinkButton variant="secondary" href={`/transfers/${tr.id}/print`}><Printer className="h-4 w-4" aria-hidden /> Transfer note</LinkButton>
        </>} />

      {open && !canReceive && tr.toBranchId !== ctx.branchId && (
        <div className="mb-6"><Callout tone="blue">This stock is on its way to {d.toName}. Staff there receive it when it arrives.</Callout></div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Items" eyebrow={`${d.lines.length} batch lines · ${money(Math.round(value), cur)} at cost`}>
          {canReceive ? (
            <ActionForm action={receiveTransferAction} successMessage="Received.">
              <input type="hidden" name="id" value={tr.id} />
              <Table head={["Product", "Batch", "Expiry", "Sent", "Received"]}>
                {d.lines.map((x) => (
                  <tr key={x.l.id}>
                    <Td><div className="font-medium">{x.name}</div><div className="text-xs text-muted">{x.strength}</div></Td>
                    <Td className="font-mono text-xs">{x.batchNo || "—"}</Td>
                    <Td className="tabular-nums">{x.expiry ?? "—"}</Td>
                    <Td className="tabular-nums">{x.l.qty} {x.baseUnit}</Td>
                    <Td><Input name={`got_${x.l.id}`} type="number" min={0} max={x.l.qty} defaultValue={x.l.qty} inputMode="numeric" className="w-24" aria-label={`Received of ${x.name}`} /></Td>
                  </tr>
                ))}
              </Table>
              <Field label="If anything is short, what happened?" hint="Needed only when you received less than was sent. A stock discrepancy alert is raised.">
                <Textarea name="shortReason" rows={2} placeholder="e.g. 1 box broken in transit" />
              </Field>
              <div className="flex justify-end"><Submit size="lg">Receive into stock</Submit></div>
            </ActionForm>
          ) : (
            <Table head={["Product", "Batch", "Expiry", "Sent", "Received"]}>
              {d.lines.map((x) => (
                <tr key={x.l.id}>
                  <Td><div className="font-medium">{x.name}</div><div className="text-xs text-muted">{x.strength}</div></Td>
                  <Td className="font-mono text-xs">{x.batchNo || "—"}</Td>
                  <Td className="tabular-nums">{x.expiry ?? "—"}</Td>
                  <Td className="tabular-nums">{x.l.qty} {x.baseUnit}</Td>
                  <Td className="tabular-nums">{x.l.receivedQty == null ? <span className="text-subtle">—</span>
                    : x.l.receivedQty < x.l.qty ? <Badge tone="red">{x.l.receivedQty} · short {x.l.qty - x.l.receivedQty}</Badge> : x.l.receivedQty}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Details">
            <Dl cols={1} items={[
              ["From", d.fromName], ["To", d.toName], ["Sent", `${dateTime(tr.sentAt, tz)}${d.sentBy ? ` by ${d.sentBy}` : ""}`],
              ["Received", tr.receivedAt ? `${dateTime(tr.receivedAt, tz)}${d.receivedBy ? ` by ${d.receivedBy}` : ""}` : null],
              ["Notes", tr.notes ? <span className="whitespace-pre-line">{tr.notes}</span> : null],
            ]} />
          </Panel>
          {canCancel && (
            <Panel title="Cancel this transfer" icon={<Undo2 />}>
              <ActionForm action={cancelTransferAction}>
                <input type="hidden" name="id" value={tr.id} />
                <p className="text-sm text-muted">Everything goes back into the batches it came from.</p>
                <Field label="Reason"><Input name="reason" placeholder="e.g. Sent to the wrong branch" /></Field>
                <Submit variant="danger">Cancel transfer</Submit>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
