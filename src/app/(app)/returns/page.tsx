import { desc, eq, sql } from "drizzle-orm";
import { CalendarClock, PackageX, Receipt, Undo2 } from "lucide-react";
import { A, Badge, Kpi, LinkButton, PageHeader, Panel, Table, Tabs, Td, type Tone } from "@/components/ui";
import { supplierReturns, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, localDay, money } from "@/lib/format";
import { RETURN_REASONS } from "@/lib/purchasing";
import { buildReturnsCalendar, calendarBatches, type CalendarEntry } from "@/lib/returns-calendar";
import { RETURN_STATUS } from "../purchasing/status";

export const metadata = { title: "Supplier returns" };

const URGENCY: Record<CalendarEntry["urgency"], { label: string; tone: Tone }> = {
  missed: { label: "Missed", tone: "gray" }, this_week: { label: "This week", tone: "red" }, soon: { label: "Within 30 days", tone: "yellow" }, later: { label: "Later", tone: "blue" },
};

export default async function ReturnsPage({ searchParams }: PageProps<"/returns">) {
  const ctx = await requireCtx("purchasing.manage");
  const sp = await searchParams;
  const view = sp.view === "notes" || sp.view === "report" ? sp.view : "calendar";
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const today = localDay(tz);
  const d = await tx(ctx, async (t) => ({
    groups: buildReturnsCalendar(await calendarBatches(t, ctx.branchId, tz), today, { includeMissed: sp.missed === "1" }),
    notes: await t.select({ r: supplierReturns, supplier: suppliers.name }).from(supplierReturns).innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
      .where(eq(supplierReturns.branchId, ctx.branchId)).orderBy(desc(supplierReturns.createdAt)).limit(200),
    report: await t.select({
      supplierId: supplierReturns.supplierId, supplier: suppliers.name, n: sql<number>`count(*)::int`,
      returned: sql<number>`sum(${supplierReturns.valueMinor})::int`, credited: sql<number>`sum(${supplierReturns.creditedMinor})::int`,
      pending: sql<number>`coalesce(sum(${supplierReturns.valueMinor}) filter (where ${supplierReturns.status} = 'sent'), 0)::int`,
      rejected: sql<number>`coalesce(sum(${supplierReturns.valueMinor}) filter (where ${supplierReturns.status} = 'rejected'), 0)::int`,
    }).from(supplierReturns).innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId)).where(eq(supplierReturns.branchId, ctx.branchId))
      .groupBy(supplierReturns.supplierId, suppliers.name).orderBy(suppliers.name),
  }));
  const entries = d.groups.flatMap((g) => g.entries).filter((e) => e.urgency !== "missed");
  const soonValue = entries.filter((e) => e.urgency !== "later").reduce((s, e) => s + e.valueMinor, 0);
  const totals = d.report.reduce((a, r) => ({ returned: a.returned + r.returned, credited: a.credited + r.credited, pending: a.pending + r.pending }), { returned: 0, credited: 0, pending: 0 });

  return (
    <>
      <PageHeader eyebrow="Stock" title="Supplier returns" icon={<Undo2 />} subtitle="Send stock back before the supplier's return window closes, and track the credit notes."
        actions={<LinkButton href="/returns/new"><Undo2 className="h-4 w-4" aria-hidden />New return</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Closing this week" value={entries.filter((e) => e.urgency === "this_week").length} tone="red" icon={<CalendarClock />} sub="batches" />
        <Kpi label="Returnable in 30 days" value={money(soonValue, cur)} tone="yellow" icon={<PackageX />} sub="at cost, before the window closes" />
        <Kpi label="Awaiting credit" value={money(totals.pending, cur)} tone="blue" icon={<Receipt />} href="/returns?view=notes" />
        <Kpi label="Credited so far" value={money(totals.credited, cur)} tone="green" icon={<Receipt />} sub={`of ${money(totals.returned, cur)} returned`} href="/returns?view=report" />
      </div>
      <Tabs current={view} tabs={[
        { key: "calendar", href: "/returns", label: "Returns calendar", count: entries.length },
        { key: "notes", href: "/returns?view=notes", label: "Return notes", count: d.notes.length },
        { key: "report", href: "/returns?view=report", label: "Returned vs credited" },
      ]} />

      {view === "calendar" && (
        d.groups.length === 0 ? (
          <Panel><p className="py-8 text-center text-sm text-muted">No batches with a return deadline. Deadlines come from each supplier&apos;s return terms and the batch&apos;s expiry and delivery date.</p></Panel>
        ) : (
          <div className="space-y-6">
            <p className="text-sm text-muted">Last day each supplier still takes the batch back. {sp.missed === "1" ? <A href="/returns">Hide missed deadlines</A> : <A href="/returns?missed=1">Show missed deadlines</A>}</p>
            {d.groups.map((g) => (
              <form key={g.supplierId} action="/returns/new" method="get">
                <Panel title={g.supplierName} eyebrow={`Next deadline ${dateOnly(g.nextDeadline, "UTC")} · ${money(g.valueMinor, cur)} at cost`}
                  actions={<button className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-aurora px-3 text-xs font-medium text-on-accent shadow-glow">Return ticked</button>}>
                  <Table head={["", "Product", "Batch", "Expiry", "Received", "Return by", "On hand", "Value"]}>
                    {g.entries.map((e) => (
                      <tr key={e.batchId}>
                        <Td><input type="checkbox" name="batch" value={e.batchId} defaultChecked={e.urgency === "this_week"} aria-label={`Return ${e.productName} batch ${e.batchNo}`} className="h-4 w-4 accent-[var(--accent)]" /></Td>
                        <Td className="font-medium">{e.productName}{e.quarantined && <span className="ml-2"><Badge tone="red">Quarantined</Badge></span>}</Td>
                        <Td className="font-mono text-xs">{e.batchNo || "—"}</Td>
                        <Td className="text-muted">{e.expiry ? dateOnly(e.expiry, "UTC") : "—"}</Td>
                        <Td className="text-muted">{dateOnly(e.receivedDay, "UTC")}</Td>
                        <Td><span className="mr-2 tabular-nums">{dateOnly(e.deadline, "UTC")}</span><Badge tone={URGENCY[e.urgency].tone}>{e.daysLeft >= 0 ? `${e.daysLeft} days` : URGENCY[e.urgency].label}</Badge></Td>
                        <Td className="tabular-nums">{e.qty}</Td>
                        <Td className="text-right tabular-nums">{money(e.valueMinor, cur)}</Td>
                      </tr>
                    ))}
                  </Table>
                </Panel>
              </form>
            ))}
          </div>
        )
      )}

      {view === "notes" && (
        <Panel>
          <Table head={["Return", "Supplier", "Reason", "Status", "Sent", "Value", "Credited", "Credit note"]} empty="No returns yet">
            {d.notes.map(({ r, supplier }) => (
              <tr key={r.id}>
                <Td><A href={`/returns/${r.id}`} className="font-mono text-xs">{r.returnNo}</A></Td>
                <Td className="font-medium">{supplier}</Td>
                <Td className="text-muted">{RETURN_REASONS[r.reason as keyof typeof RETURN_REASONS] ?? r.reason}</Td>
                <Td><Badge tone={RETURN_STATUS[r.status]?.tone ?? "gray"}>{RETURN_STATUS[r.status]?.label ?? r.status}</Badge></Td>
                <Td className="text-muted">{dateOnly(r.createdAt, tz)}</Td>
                <Td className="tabular-nums">{money(r.valueMinor, cur)}</Td>
                <Td className="tabular-nums">{r.creditedAt ? money(r.creditedMinor, cur) : "—"}</Td>
                <Td className="font-mono text-xs text-muted">{r.creditNoteNo ?? "—"}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      {view === "report" && (
        <Panel title="Returned vs credited" eyebrow="By supplier, at cost">
          <Table head={["Supplier", "Returns", "Returned", "Credited", "Awaiting", "Rejected", "Recovered"]} empty="No returns yet">
            {d.report.map((r) => (
              <tr key={r.supplierId}>
                <Td><A href={`/suppliers/${r.supplierId}`}>{r.supplier}</A></Td>
                <Td className="tabular-nums">{r.n}</Td>
                <Td className="tabular-nums">{money(r.returned, cur)}</Td>
                <Td className="tabular-nums text-ok">{money(r.credited, cur)}</Td>
                <Td className="tabular-nums">{money(r.pending, cur)}</Td>
                <Td className="tabular-nums text-bad">{r.rejected ? money(r.rejected, cur) : "—"}</Td>
                <Td className="tabular-nums">{r.returned ? `${Math.round((r.credited / r.returned) * 100)}%` : "—"}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </>
  );
}
