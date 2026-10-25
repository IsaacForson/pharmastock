import { Download, Send } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { Badge, Dl, Table, Td } from "@/components/ui";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateOnly, money, toMajor } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { PrintDoc } from "../../sales/print-doc";
import { removeClaimItemAction, settleItemAction, submitClaimAction } from "../actions";
import { CLAIM_TONE, ITEM_TONE } from "../tone";
import { loadClaim } from "./data";

export const metadata = { title: "Claim" };

export default async function ClaimPage({ params }: PageProps<"/claims/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx("claims.manage");
  if (!/^[0-9a-f-]{36}$/.test(id) || !hasFeature(ctx.tenant, "claims")) notFound();
  const d = await tx(ctx, async (t) => {
    const c = await loadClaim(t, id);
    if (c) await audit(t, ctx, "view", "claim", id);
    return c;
  });
  if (!d) notFound();
  const { c, payer } = d;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const write = ctx.access === "full";
  const draft = c.status === "draft";
  return (
    <PrintDoc tenant={ctx.tenant} title={`Claim ${c.batchNo}`} back="/claims" actions={<>
      <a href={`/claims/${c.id}/csv`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3"><Download className="h-4 w-4" aria-hidden /> CSV</a>
      {draft && write && <ActionButton action={submitClaimAction} fields={{ id: c.id }} variant="primary" confirm="Mark this claim as sent to the payer?"><Send className="h-4 w-4" aria-hidden /> Mark submitted</ActionButton>}
    </>}>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <Dl items={[
          ["Payer", `${payer.name}${payer.code ? ` (${payer.code})` : ""}`], ["Period", `${c.periodStart} to ${c.periodEnd}`],
          ["Claimed", <strong key="c" className="tabular-nums">{money(c.totalClaimedMinor, cur)}</strong>], ["Paid", money(c.totalPaidMinor, cur)],
          ["Submitted", c.submittedAt ? dateOnly(c.submittedAt, tz) : "Not yet"], ["Items", d.items.length],
        ]} />
        <Badge tone={CLAIM_TONE[c.status]}>{c.status.replace("_", " ")}</Badge>
      </div>
      <Table head={["Sale", "Date", "Customer", "Member no.", "Claimed", "Paid", "Status", ""]}>
        {d.items.map((r) => (
          <tr key={r.i.id} className="align-top">
            <Td><Link href={`/sales/${r.i.saleId}`} className="font-mono text-xs text-accent hover:underline print:text-fg">{r.saleNo}</Link></Td>
            <Td className="text-muted">{dateOnly(r.soldAt, tz)}</Td>
            <Td>{r.customer ?? "—"}<div className="font-mono text-xs text-muted">{r.customerNo}</div></Td>
            <Td>{r.memberNo ?? "—"}</Td>
            <Td className="tabular-nums">{money(r.i.amountClaimedMinor, cur)}</Td>
            <Td className="tabular-nums">{money(r.i.amountPaidMinor, cur)}</Td>
            <Td><Badge tone={ITEM_TONE[r.i.status] ?? "gray"}>{r.i.status.replace("_", " ")}</Badge>{r.i.rejectionReason && <div className="mt-1 max-w-48 whitespace-normal text-xs text-bad">{r.i.rejectionReason}</div>}</Td>
            <Td className="print:hidden">
              {write && draft && <ActionButton action={removeClaimItemAction} fields={{ itemId: r.i.id, claimId: c.id }} variant="ghost">Remove</ActionButton>}
              {write && !draft && (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-accent">Record</summary>
                  <ActionForm action={settleItemAction} className="mt-2 w-60">
                    <input type="hidden" name="itemId" value={r.i.id} /><input type="hidden" name="claimId" value={c.id} />
                    <input name="paid" inputMode="decimal" defaultValue={toMajor(r.i.amountPaidMinor || r.i.amountClaimedMinor)} aria-label="Amount paid" className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-right text-sm tabular-nums text-fg" />
                    <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="rejected" defaultChecked={r.i.status === "rejected"} /> Rejected</label>
                    <input name="reason" placeholder="Reason given by the payer" defaultValue={r.i.rejectionReason ?? ""} className="h-9 w-full rounded-lg border border-line bg-surface-2 px-2 text-xs text-fg" />
                    <Submit size="sm">Save</Submit>
                  </ActionForm>
                </details>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <p className="mt-8 border-t border-dashed border-line-strong pt-4 text-xs text-subtle">Total claimed {money(c.totalClaimedMinor, cur)} for {d.items.length} sale{d.items.length === 1 ? "" : "s"}. Prepared by {ctx.tenant.name}.</p>
    </PrintDoc>
  );
}
