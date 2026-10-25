import { PrintButton } from "@/components/form";
import { requireCtx } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { loadTransfer } from "../data";

export const metadata = { title: "Transfer note" };

export default async function TransferNotePage({ params }: PageProps<"/transfers/[id]/print">) {
  const ctx = await requireCtx("stock.transfer");
  const d = await loadTransfer(ctx, (await params).id);
  const { tr } = d, t = ctx.tenant;
  const total = d.lines.reduce((s, x) => s + x.l.qty * x.cost, 0);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <article className="sheet space-y-6 p-8 print:border-0 print:bg-transparent print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b border-line pb-4">
          <div>
            <h1 className="text-xl font-semibold text-fg">{t.name}</h1>
            {t.letterhead && <p className="whitespace-pre-line text-xs text-muted">{t.letterhead}</p>}
            <p className="text-xs text-muted">{[t.address, t.phone, t.licenceNo && `Licence ${t.licenceNo}`].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-mono uppercase tracking-wider text-subtle">Stock transfer note</div>
            <div className="font-mono text-sm text-fg">{tr.transferNo}</div>
            <div className="text-xs text-muted">{dateTime(tr.sentAt, t.timezone)}</div>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-6 text-sm">
          <div><div className="text-[10px] font-mono uppercase tracking-wider text-subtle">From</div><div className="font-medium text-fg">{d.fromName}</div><div className="text-muted">{d.fromAddress}</div></div>
          <div><div className="text-[10px] font-mono uppercase tracking-wider text-subtle">To</div><div className="font-medium text-fg">{d.toName}</div><div className="text-muted">{d.toAddress}</div></div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-subtle">
            <th className="py-2">Product</th><th>Batch</th><th>Expiry</th><th className="text-right">Qty sent</th><th className="text-right">Received</th><th className="text-right">Value</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {d.lines.map((x) => (
              <tr key={x.l.id}>
                <td className="py-2 text-fg">{x.name} {x.strength && <span className="text-muted">{x.strength}</span>}</td>
                <td className="font-mono text-xs">{x.batchNo || "—"}</td>
                <td className="tabular-nums">{x.expiry ?? "—"}</td>
                <td className="text-right tabular-nums">{x.l.qty} {x.baseUnit}</td>
                <td className="text-right tabular-nums">{x.l.receivedQty ?? "______"}</td>
                <td className="text-right tabular-nums">{money(Math.round(x.l.qty * x.cost), t.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="border-t border-line-strong font-medium"><td className="py-2" colSpan={5}>Total at cost</td><td className="text-right tabular-nums">{money(Math.round(total), t.currency)}</td></tr></tfoot>
        </table>
        {tr.notes && <p className="whitespace-pre-line text-sm text-muted">{tr.notes}</p>}
        <div className="grid grid-cols-2 gap-10 pt-8 text-sm">
          <div className="border-t border-line-strong pt-2 text-muted">Sent by: {d.sentBy ?? ""}</div>
          <div className="border-t border-line-strong pt-2 text-muted">Received by: {d.receivedBy ?? ""}{tr.receivedAt ? ` · ${dateTime(tr.receivedAt, t.timezone)}` : ""}</div>
        </div>
      </article>
    </div>
  );
}
