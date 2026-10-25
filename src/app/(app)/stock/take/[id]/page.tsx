import { ClipboardCheck, FileText, ListChecks } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { A, Badge, Callout, Check, Input, Kpi, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { requireCtx, tx } from "@/lib/auth";
import { localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cancelTakeAction, completeTakeAction, deleteLineAction, saveCountAction } from "../actions";
import { productForCount, varianceReport } from "../logic";
import { Counter } from "./counter";

export const metadata = { title: "Counting" };

export default async function TakePage({ params, searchParams }: PageProps<"/stock/take/[id]">) {
  const ctx = await requireCtx("stock.take");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const productId = typeof sp.product === "string" && /^[0-9a-f-]{36}$/i.test(sp.product) ? sp.product : null;
  const data = await tx(ctx, async (t) => {
    const r = await varianceReport(t, id);
    if (!r || r.take.branchId !== ctx.branchId) return null;
    return { ...r, initial: productId && r.take.status === "open" ? await productForCount(t, id, ctx.branchId, productId) : null };
  });
  if (!data) notFound();
  const { take, lines, uncounted, totals } = data;
  if (take.status !== "open") {
    return (
      <>
        <PageHeader icon={<ClipboardCheck />} eyebrow={take.takeNo} title="Stock take" subtitle={`This count is ${take.status}.`} actions={<LinkButton href={`/stock/take/${take.id}/report`}>View report</LinkButton>} />
      </>
    );
  }
  const cur = ctx.tenant.currency;
  const canComplete = can(ctx.user.role, "stock.adjust");

  return (
    <>
      <PageHeader icon={<ClipboardCheck />} eyebrow={`${take.takeNo} · ${take.scope === "full" ? "Full count" : "Partial count"}`} title="Counting" subtitle={take.notes ?? "Scan each item, pick its batch, enter what's on the shelf."}
        actions={<>
          <LinkButton variant="secondary" href={`/stock/take/${take.id}/report`}><FileText className="h-4 w-4" aria-hidden />Variance report</LinkButton>
          <ActionButton action={cancelTakeAction} fields={{ takeId: take.id }} variant="ghost" confirm="Cancel this stock take? Counts are kept for reference but nothing is adjusted.">Cancel take</ActionButton>
        </>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Lines counted" value={totals.lines} icon={<ListChecks />} />
        <Kpi label="Over" value={totals.over} tone="green" sub="counted more than the system" />
        <Kpi label="Short" value={totals.short} tone="red" sub="counted less than the system" />
        <Kpi label="Variance at cost" value={money(totals.varianceMinor, cur)} tone={totals.varianceMinor < 0 ? "red" : "green"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Counter takeId={take.id} initial={data.initial} today={localDay(ctx.tenant.timezone)} />

          <Panel title="Counted so far" eyebrow={`${lines.length} lines`}>
            <Table head={["Product", "Batch", "Expiry", "Expected", "Counted", "Variance", ""]} empty="Nothing counted yet. Scan the first item above.">
              {[...lines].reverse().map((l) => (
                <tr key={l.id}>
                  <Td>{l.name} {l.strength && <span className="text-muted">{l.strength}</span>}</Td>
                  <Td className="font-mono text-xs">{l.batchNo || "—"} {!l.batchId && <Badge tone="teal">Found</Badge>}</Td>
                  <Td className="text-muted">{l.expiry ?? "—"}</Td>
                  <Td className="tabular-nums">{l.expectedQty}</Td>
                  <Td>
                    <ActionForm action={saveCountAction} className="flex items-center gap-2 space-y-0">
                      <input type="hidden" name="takeId" value={take.id} />
                      <input type="hidden" name="productId" value={l.productId} />
                      {l.batchId ? <input type="hidden" name="batchId" value={l.batchId} /> : <>
                        <input type="hidden" name="batchNo" value={l.batchNo ?? ""} />
                        {l.expiry && <input type="hidden" name="expiry" value={l.expiry} />}
                      </>}
                      <Input name="qty" defaultValue={l.countedQty} inputMode="numeric" aria-label={`Counted ${l.name}`} className="h-8 w-20 tabular-nums" />
                      <Submit size="sm" variant="ghost">Update</Submit>
                    </ActionForm>
                  </Td>
                  <Td className="tabular-nums">
                    <span className={l.variance < 0 ? "text-bad" : l.variance > 0 ? "text-ok" : "text-muted"}>{l.variance > 0 ? "+" : ""}{l.variance}</span>
                    <span className="ml-1 text-xs text-subtle">{money(l.varianceMinor, cur)}</span>
                  </Td>
                  <Td className="text-right"><ActionButton action={deleteLineAction} fields={{ takeId: take.id, lineId: l.id }} variant="ghost" confirm="Remove this count?">Remove</ActionButton></Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>

        <Panel title="Finish" icon={<ClipboardCheck />} className="h-fit lg:sticky lg:top-24">
          {canComplete ? (
            <ActionForm action={completeTakeAction} onSuccessHref={`/stock/take/{id}/report`}>
              <input type="hidden" name="takeId" value={take.id} />
              <p className="text-sm text-muted">Completing corrects stock to your counts ({money(totals.varianceMinor, cur)} at cost). Batches you counted are adjusted by the difference found at the time of counting, so sales since then stay right.</p>
              {take.scope === "full" && uncounted.length > 0 && (
                <Callout tone="yellow">
                  <p>{uncounted.length} batches with stock haven&apos;t been counted ({money(-totals.uncountedMinor, cur)} at cost). <A href={`/stock/take/${take.id}/report`}>See them</A>.</p>
                  <Check name="zeroUncounted" label={`Set ${uncounted.length} uncounted batches to zero`} className="mt-2" />
                </Callout>
              )}
              <div className="flex justify-end"><Submit>Complete stock take</Submit></div>
            </ActionForm>
          ) : <p className="text-sm text-muted">A pharmacist or manager completes the take and applies the corrections. Keep counting until everything is done.</p>}
        </Panel>
      </div>
    </>
  );
}
