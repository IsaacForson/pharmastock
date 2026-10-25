import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/form";
import { LinkButton } from "@/components/ui";
import { branches, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { varianceReport } from "../../logic";

export const metadata = { title: "Stock take report" };

export default async function TakeReportPage({ params }: PageProps<"/stock/take/[id]/report">) {
  const ctx = await requireCtx("stock.take");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await tx(ctx, async (t) => {
    const r = await varianceReport(t, id);
    if (!r || r.take.branchId !== ctx.branchId) return null;
    const [branch] = await t.select({ name: branches.name }).from(branches).where(eq(branches.id, r.take.branchId));
    const names = new Map((await t.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
    return { ...r, branch: branch?.name ?? "", names };
  });
  if (!data) notFound();
  const { take, lines, uncounted, totals, names } = data;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const th = "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle";
  const td = "px-2 py-1.5 tabular-nums";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex justify-end gap-2 print:hidden">
        <LinkButton variant="ghost" href={`/stock/take/${take.id}`}>Back</LinkButton>
        <PrintButton />
      </div>
      <article className="sheet p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 border-b border-line pb-4">
          <h1 className="text-xl font-semibold text-fg">{ctx.tenant.name}</h1>
          {ctx.tenant.letterhead && <p className="whitespace-pre-line text-xs text-muted">{ctx.tenant.letterhead}</p>}
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
            <div><span className="font-semibold text-fg">Stock take variance report</span> · {data.branch}</div>
            <div className="font-mono text-xs text-muted">{take.takeNo} · {take.scope} · {take.status}</div>
          </div>
          <p className="mt-1 text-xs text-muted">
            Started {dateTime(take.startedAt, tz)}{take.startedBy ? ` by ${names.get(take.startedBy) ?? ""}` : ""}
            {take.completedAt ? ` · ${take.status === "cancelled" ? "Cancelled" : "Completed"} ${dateTime(take.completedAt, tz)}${take.completedBy ? ` by ${names.get(take.completedBy) ?? ""}` : ""}` : ""}
          </p>
        </header>

        <table className="w-full text-sm">
          <thead><tr className="border-b border-line">
            {["Product", "Batch", "Expiry", "Expected", "Counted", "Variance", "Value"].map((h) => <th key={h} className={th}>{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => (
              <tr key={l.id} className="text-fg">
                <td className="px-2 py-1.5">{l.name} {l.strength}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{l.batchNo || "—"}{!l.batchId && " (found)"}</td>
                <td className="px-2 py-1.5">{l.expiry ?? "—"}</td>
                <td className={td}>{l.expectedQty}</td>
                <td className={td}>{l.countedQty}</td>
                <td className={td}>{l.variance > 0 ? "+" : ""}{l.variance} {l.baseUnit}</td>
                <td className={td}>{money(l.varianceMinor, cur)}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={7} className="px-2 py-6 text-center text-muted">Nothing counted.</td></tr>}
          </tbody>
          <tfoot><tr className="border-t border-line-strong font-semibold text-fg">
            <td colSpan={6} className="px-2 py-2">Counted lines: {totals.lines} · over {totals.over} · short {totals.short}</td>
            <td className={td}>{money(totals.varianceMinor, cur)}</td>
          </tr></tfoot>
        </table>

        {uncounted.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-semibold text-fg">Not counted yet: set to zero if the take is completed</h2>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line">{["Product", "Batch", "Expiry", "System qty", "Value"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {uncounted.map((b) => (
                  <tr key={b.id} className="text-fg">
                    <td className="px-2 py-1.5">{b.name} {b.strength}</td>
                    <td className="px-2 py-1.5 font-mono text-xs">{b.batchNo || "—"}</td>
                    <td className="px-2 py-1.5">{b.expiry ?? "—"}</td>
                    <td className={td}>{b.qtyOnHand} {b.baseUnit}</td>
                    <td className={td}>{money(b.varianceMinor, cur)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line-strong font-semibold text-fg"><td colSpan={4} className="px-2 py-2">Total</td><td className={td}>{money(totals.uncountedMinor, cur)}</td></tr></tfoot>
            </table>
          </section>
        )}

        <footer className="mt-10 grid grid-cols-2 gap-8 text-xs text-muted">
          <div className="border-t border-line pt-2">Counted by</div>
          <div className="border-t border-line pt-2">Checked by</div>
        </footer>
      </article>
    </div>
  );
}
