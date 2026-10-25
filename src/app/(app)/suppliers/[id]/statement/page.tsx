import { and, eq, gt, isNotNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/form";
import { A, Input } from "@/components/ui";
import { goodsReceipts, supplierPayments, supplierReturns, suppliers } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { addDays, dateOnly, localDay, money } from "@/lib/format";
import { BUCKET_LABELS, BUCKETS, supplierBalances } from "@/lib/purchasing";
import { Letterhead, Sheet } from "../../../purchasing/letterhead";

export const metadata = { title: "Supplier statement" };

type Entry = { day: string; ref: string; what: string; debit: number; credit: number };

export default async function StatementPage({ params, searchParams }: PageProps<"/suppliers/[id]/statement">) {
  const ctx = await requireCtx("purchasing.manage");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const today = localDay(tz);
  const from = typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(today, -90);
  const d = await tx(ctx, async (t) => {
    const [s] = await t.select().from(suppliers).where(eq(suppliers.id, id));
    if (!s) return null;
    const [grns, pays, credits, bal] = await Promise.all([
      t.select().from(goodsReceipts).where(eq(goodsReceipts.supplierId, id)),
      t.select().from(supplierPayments).where(eq(supplierPayments.supplierId, id)),
      t.select().from(supplierReturns).where(and(eq(supplierReturns.supplierId, id), isNotNull(supplierReturns.creditedAt), gt(supplierReturns.creditedMinor, 0))),
      supplierBalances(t, today, id),
    ]);
    await audit(t, ctx, "print", "supplier_statement", id);
    return { s, grns, pays, credits, bal: bal.get(id) };
  });
  if (!d) notFound();
  const all: Entry[] = [
    ...d.grns.map((g) => ({ day: localDay(tz, g.receivedAt), ref: g.grnNo, what: `Delivery${g.supplierInvoiceNo ? `, invoice ${g.supplierInvoiceNo}` : ""}`, debit: g.totalMinor, credit: 0 })),
    ...d.pays.map((p) => ({ day: p.paidAt, ref: p.reference ?? "", what: `Payment (${p.method.replace("_", " ")})`, debit: 0, credit: p.amountMinor })),
    ...d.credits.map((r) => ({ day: localDay(tz, r.creditedAt!), ref: r.creditNoteNo ?? r.returnNo, what: `Credit note for return ${r.returnNo}`, debit: 0, credit: r.creditedMinor })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const opening = all.filter((e) => e.day < from).reduce((s, e) => s + e.debit - e.credit, 0);
  const rows = all.filter((e) => e.day >= from).reduce<(Entry & { balance: number })[]>((acc, e) => [...acc, { ...e, balance: (acc.at(-1)?.balance ?? opening) + e.debit - e.credit }], []);
  const closing = rows.at(-1)?.balance ?? opening;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <A href={`/suppliers/${id}`}>← Back to supplier</A>
        <form className="flex items-center gap-2"><label className="text-sm text-muted" htmlFor="from">From</label><Input id="from" type="date" name="from" defaultValue={from} className="w-44" /><button className="h-10 rounded border border-line bg-surface-2 px-3 text-sm text-fg hover:bg-surface-3">Show</button></form>
        <PrintButton />
      </div>
      <Sheet>
        <Letterhead tenant={ctx.tenant} title="Supplier statement" number={d.s.name}>
          <div>{dateOnly(from, "UTC")} to {dateOnly(today, "UTC")}</div>
        </Letterhead>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-subtle"><th className="py-2">Date</th><th className="py-2">Ref</th><th className="py-2">Details</th><th className="py-2 text-right">Owed</th><th className="py-2 text-right">Paid</th><th className="py-2 text-right">Balance</th></tr></thead>
          <tbody className="divide-y divide-line">
            <tr><td className="py-2 text-muted">{dateOnly(from, "UTC")}</td><td /><td className="py-2 text-muted">Opening balance</td><td /><td /><td className="py-2 text-right tabular-nums">{money(opening, cur)}</td></tr>
            {rows.map((e, i) => (
              <tr key={i}>
                <td className="py-2 text-muted">{dateOnly(e.day, "UTC")}</td><td className="py-2 font-mono text-xs">{e.ref}</td><td className="py-2">{e.what}</td>
                <td className="py-2 text-right tabular-nums">{e.debit ? money(e.debit, cur) : ""}</td><td className="py-2 text-right tabular-nums">{e.credit ? money(e.credit, cur) : ""}</td>
                <td className="py-2 text-right tabular-nums">{money(e.balance, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line-strong"><td colSpan={5} className="py-3 text-right font-semibold">Balance owed</td><td className="py-3 text-right text-base font-semibold tabular-nums">{money(closing, cur)}</td></tr></tfoot>
        </table>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          {BUCKETS.map((b) => <div key={b} className="rounded border border-line p-2"><div className="text-subtle">{BUCKET_LABELS[b]}</div><div className="mt-0.5 font-semibold tabular-nums text-fg">{money(d.bal?.buckets[b] ?? 0, cur)}</div></div>)}
        </div>
      </Sheet>
    </div>
  );
}
