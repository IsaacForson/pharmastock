import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ActionForm, PrintButton, Submit } from "@/components/form";
import { A, Badge, Check, Field, Input, Panel } from "@/components/ui";
import { branches, products, stockBatches, supplierReturnLines, supplierReturns, suppliers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, dateTime, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { RETURN_REASONS } from "@/lib/purchasing";
import { Letterhead, Sheet } from "../../purchasing/letterhead";
import { RETURN_STATUS } from "../../purchasing/status";
import { recordCreditAction } from "../actions";

export const metadata = { title: "Return note" };

export default async function ReturnPage({ params }: PageProps<"/returns/[id]">) {
  const ctx = await requireCtx("purchasing.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tx(ctx, async (t) => {
    const [row] = await t.select({ r: supplierReturns, s: suppliers, b: branches, by: users.name }).from(supplierReturns)
      .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId)).innerJoin(branches, eq(branches.id, supplierReturns.branchId))
      .leftJoin(users, eq(users.id, supplierReturns.createdBy)).where(eq(supplierReturns.id, id));
    if (!row) return null;
    const lines = await t.select({ l: supplierReturnLines, name: products.name, strength: products.strength, baseUnit: products.baseUnit, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry })
      .from(supplierReturnLines).innerJoin(products, eq(products.id, supplierReturnLines.productId)).innerJoin(stockBatches, eq(stockBatches.id, supplierReturnLines.batchId))
      .where(eq(supplierReturnLines.returnId, id)).orderBy(products.name);
    return { ...row, lines };
  });
  if (!d) notFound();
  const { r, s } = d;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const st = RETURN_STATUS[r.status] ?? { label: r.status, tone: "gray" as const };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden"><A href="/returns?view=notes">← All returns</A><PrintButton /></div>
      <Sheet>
        <Letterhead tenant={ctx.tenant} branch={d.b} title="Return note" number={r.returnNo}>
          <div>{dateTime(r.createdAt, tz)}</div>
          <div className="print:hidden"><Badge tone={st.tone}>{st.label}</Badge></div>
        </Letterhead>
        <section className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-subtle">Returned to</div>
            <div className="mt-1 font-semibold text-fg">{s.name}</div>
            <div className="text-muted">{[s.address, s.phone, s.email].filter(Boolean).join(" · ")}</div>
            {s.licenceNo && <div className="text-xs text-subtle">Licence {s.licenceNo}</div>}
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-subtle">Reason</div>
            <div className="mt-1 text-fg">{RETURN_REASONS[r.reason as keyof typeof RETURN_REASONS] ?? r.reason}</div>
            {r.notes && <div className="text-muted">{r.notes}</div>}
          </div>
        </section>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-subtle"><th className="py-2">Product</th><th className="py-2">Batch</th><th className="py-2">Expiry</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Cost each</th><th className="py-2 text-right">Value</th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.lines.map(({ l, name, strength, baseUnit, batchNo, expiry }) => (
              <tr key={l.id}>
                <td className="py-2 font-medium text-fg">{name} {strength}</td><td className="py-2 font-mono text-xs">{batchNo || "—"}</td>
                <td className="py-2 tabular-nums">{expiry ? dateOnly(expiry, "UTC") : "—"}</td><td className="py-2 text-right tabular-nums">{l.qty} {baseUnit}</td>
                <td className="py-2 text-right tabular-nums">{money(l.unitCostMinor, cur)}</td><td className="py-2 text-right tabular-nums">{money(Math.round(l.qty * l.unitCostMinor), cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong"><td colSpan={5} className="py-3 text-right font-semibold">Value at cost</td><td className="py-3 text-right text-base font-semibold tabular-nums">{money(r.valueMinor, cur)}</td></tr>
            {r.creditedAt && <tr><td colSpan={5} className="py-1 text-right text-muted">Credited{r.creditNoteNo ? ` (note ${r.creditNoteNo})` : ""}</td><td className="py-1 text-right tabular-nums">{money(r.creditedMinor, cur)}</td></tr>}
          </tfoot>
        </table>
        <div className="grid grid-cols-2 gap-10 pt-8 text-xs text-muted">
          <div className="border-t border-line pt-2">Released by {d.by ? `(${d.by})` : ""}</div>
          <div className="border-t border-line pt-2">Received by supplier (name, signature, date)</div>
        </div>
      </Sheet>
      {can(ctx.user.role, "supplier.payments") && r.status !== "credited" && (
        <div className="mx-auto max-w-3xl print:hidden">
          <Panel title="Record the credit note" eyebrow="When the supplier settles">
            <ActionForm action={recordCreditAction}>
              <input type="hidden" name="id" value={r.id} />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Credit note no."><Input name="creditNoteNo" defaultValue={r.creditNoteNo ?? ""} /></Field>
                <Field label="Amount credited" hint={`Returned value ${money(r.valueMinor, cur)}`}><Input name="amount" inputMode="decimal" placeholder={(r.valueMinor / 100).toFixed(2)} /></Field>
                <div className="flex items-end pb-2"><Check name="rejected" label="Supplier rejected the return" /></div>
              </div>
              <div className="flex justify-end"><Submit>Save</Submit></div>
            </ActionForm>
          </Panel>
        </div>
      )}
    </div>
  );
}
