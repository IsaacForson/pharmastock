import { cx } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { fmtQty, METHOD_LABEL, type ReceiptData } from "@/lib/receipt";

/**
 * The receipt as people see it: 80mm thermal (default) or an A4 invoice. Pure markup with no server imports, so the
 * offline till renders the same receipt from local data.
 */
export function ReceiptView({ d, format = "thermal" }: { d: ReceiptData; format?: "thermal" | "a4" }) {
  const m = (v: number) => money(v, d.currency);
  const thermal = format === "thermal";
  const row = (k: React.ReactNode, v: React.ReactNode, strong?: boolean) => (
    <div className={cx("flex justify-between gap-3", strong && "font-semibold")}><span>{k}</span><span className="tabular-nums">{v}</span></div>
  );
  return (
    <article className={cx("bg-surface text-fg print:bg-transparent", thermal ? "receipt-80 mx-auto w-[80mm] max-w-full p-3 font-mono text-[11px] leading-snug" : "mx-auto max-w-3xl p-8 text-sm")}>
      <header className={cx("text-center", thermal ? "mb-2" : "mb-6 border-b border-line-strong pb-4 text-left")}>
        <div className={cx("font-semibold", thermal ? "text-sm" : "text-xl tracking-tight")}>{d.pharmacy.name}</div>
        {d.pharmacy.branch && <div>{d.pharmacy.branch}</div>}
        {d.pharmacy.letterhead && <div className="whitespace-pre-line text-muted">{d.pharmacy.letterhead}</div>}
        <div className="text-muted">{[d.pharmacy.address, d.pharmacy.phone].filter(Boolean).join(" · ")}</div>
        <div className="text-muted">{[d.pharmacy.licenceNo && `Licence ${d.pharmacy.licenceNo}`, d.pharmacy.taxId && `TIN ${d.pharmacy.taxId}`].filter(Boolean).join(" · ")}</div>
        {!thermal && <div className="mt-2 text-[11px] font-mono uppercase tracking-wider text-accent">Invoice / receipt</div>}
      </header>
      <section className={cx("border-y border-dashed border-line-strong py-1.5", !thermal && "grid grid-cols-2 gap-1 border-0 py-0")}>
        {row("Sale", d.saleNo)}
        {d.receiptNo && row("Receipt", d.receiptNo)}
        {row("Date", dateTime(d.soldAt, d.timezone, { dateStyle: "short", timeStyle: "short" }))}
        {d.customer && row("Customer", `${d.customer.name} (${d.customer.customerNo})`)}
        {d.rxNo && row("Prescription", d.rxNo)}
        {d.offline && row("Note", "Sold offline")}
      </section>
      {d.status === "voided" && <p className="my-2 text-center font-semibold uppercase tracking-wide text-bad">Voided</p>}
      <table className={cx("w-full", thermal ? "my-1.5" : "my-6")}>
        {!thermal && (
          <thead className="text-left text-xs text-muted"><tr><th className="py-2">Item</th><th>Qty</th><th className="text-right">Price</th><th className="text-right">Discount</th><th className="text-right">Total</th></tr></thead>
        )}
        <tbody className={cx(!thermal && "divide-y divide-line")}>
          {d.lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="py-1">
                <div className="font-semibold">{l.description}</div>
                {thermal && <div>{fmtQty(l)} @ {m(l.unitPriceMinor)}{l.discountMinor ? ` less ${m(l.discountMinor)}` : ""}</div>}
                {l.medicine && l.batches.map((b, j) => <div key={j} className="text-muted">Batch {b.batchNo || "-"}{b.expiry ? ` · Exp ${b.expiry}` : ""}</div>)}
              </td>
              {!thermal && <><td className="py-1">{fmtQty(l)}</td><td className="text-right tabular-nums">{m(l.unitPriceMinor)}</td><td className="text-right tabular-nums">{l.discountMinor ? m(l.discountMinor) : "—"}</td></>}
              <td className="py-1 text-right tabular-nums">{m(l.totalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className={cx("space-y-0.5 border-t border-dashed border-line-strong pt-1.5", !thermal && "ml-auto max-w-xs")}>
        {row("Subtotal", m(d.subtotalMinor))}
        {d.discountMinor > 0 && row("Discount", `-${m(d.discountMinor)}`)}
        {row(`${d.pharmacy.taxName}${d.pharmacy.taxInclusive ? " (included)" : ""}`, m(d.taxMinor))}
        {row("Total", m(d.totalMinor), true)}
        {d.payer && row(`${d.payer.name}${d.payer.memberNo ? ` #${d.payer.memberNo}` : ""}`, `-${m(d.payer.portionMinor)}`)}
        {d.payments.map((p, i) => <div key={i}>{row(`${METHOD_LABEL[p.method] ?? p.method}${p.reference ? ` · ${p.reference}` : ""}`, m(p.amountMinor))}</div>)}
        {d.creditMinor > 0 && row("On account", m(d.creditMinor))}
        {d.changeMinor > 0 && row("Change", m(d.changeMinor), true)}
        {d.customer && d.customer.balanceMinor !== 0 && row("Account balance", m(d.customer.balanceMinor))}
        {d.loyalty && row("Points earned / used", `${d.loyalty.earned} / ${d.loyalty.redeemed}`)}
        {d.loyalty && d.customer && row("Points balance", d.customer.points)}
      </section>
      <footer className="mt-2 space-y-0.5 border-t border-dashed border-line-strong pt-1.5 text-center">
        {d.cashier && <div>Served by {d.cashier}</div>}
        {d.pharmacist && <div>Pharmacist: {d.pharmacist}{d.pharmacistRegNo ? ` (${d.pharmacistRegNo})` : ""}</div>}
        {d.lines.some((l) => l.medicine) && <div className="font-semibold">{d.pharmacy.labelWarning}</div>}
        <div className="text-muted">{d.pharmacy.footer || "Thank you. Get well soon."}</div>
      </footer>
    </article>
  );
}
