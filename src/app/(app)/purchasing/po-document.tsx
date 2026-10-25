import type { suppliers } from "@/db/schema";

type Supplier = typeof suppliers.$inferSelect;

/** Body of a printed / portal purchase order: supplier block, lines, total, notes. */
export function PoDocument({ supplier, lines, totalMinor, notes, fmt }: {
  supplier: Supplier; lines: { name: string; strength: string | null; unit: string; qty: number; unitCostMinor: number }[]; totalMinor: number; notes: string | null; fmt: (minor: number) => string;
}) {
  return (
    <>
      <section className="text-sm">
        <div className="text-[10px] font-mono uppercase tracking-wider text-subtle">To</div>
        <div className="mt-1 font-semibold text-fg">{supplier.name}</div>
        {supplier.contactName && <div className="text-muted">Attn: {supplier.contactName}</div>}
        <div className="text-muted">{[supplier.address, supplier.phone, supplier.email].filter(Boolean).join(" · ")}</div>
      </section>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-subtle"><th className="py-2">#</th><th className="py-2">Product</th><th className="py-2">Pack</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Unit cost</th><th className="py-2 text-right">Total</th></tr></thead>
        <tbody className="divide-y divide-line">
          {lines.map((l, i) => (
            <tr key={i}><td className="py-2 text-muted">{i + 1}</td><td className="py-2 font-medium text-fg">{l.name} {l.strength}</td><td className="py-2 text-muted">{l.unit}</td>
              <td className="py-2 text-right tabular-nums">{l.qty}</td><td className="py-2 text-right tabular-nums">{fmt(l.unitCostMinor)}</td><td className="py-2 text-right tabular-nums">{fmt(l.qty * l.unitCostMinor)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-line-strong"><td colSpan={5} className="py-3 text-right font-semibold">Total</td><td className="py-3 text-right text-base font-semibold tabular-nums">{fmt(totalMinor)}</td></tr></tfoot>
      </table>
      {notes && <p className="whitespace-pre-line text-sm text-muted"><span className="font-medium text-fg">Notes: </span>{notes}</p>}
    </>
  );
}
