import { and, desc, eq, inArray } from "drizzle-orm";
import { Wallet } from "lucide-react";
import { ActionForm, PrintButton, Submit } from "@/components/form";
import { Badge, Dl, EmptyState, Field, Input, Kpi, LinkButton, PageHeader, Panel, Table, Td, Textarea, Toolbar } from "@/components/ui";
import { can } from "@/lib/permissions";
import { cashUps, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { DRAWER_METHODS } from "@/lib/cashup";
import { dateTime, localDay, money } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/receipt";
import { saveCashupAction } from "./actions";
import { daySummary } from "./data";

export const metadata = { title: "Daily close" };

export default async function CashupPage({ searchParams }: PageProps<"/cashup">) {
  const ctx = await requireCtx("cashup");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const today = localDay(tz);
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && sp.day <= today ? sp.day : today;
  const m = (v: number) => money(v, cur);
  const d = await tx(ctx, async (t) => {
    const s = await daySummary(t, ctx.branchId, day, tz);
    const history = await t.select({ c: cashUps, by: users.name }).from(cashUps).leftJoin(users, eq(users.id, cashUps.userId))
      .where(eq(cashUps.branchId, ctx.branchId)).orderBy(desc(cashUps.createdAt)).limit(30);
    const ids = s.perCashier.map((c) => c.userId).filter(Boolean) as string[];
    const names = ids.length ? await t.select({ id: users.id, name: users.name }).from(users).where(and(inArray(users.id, ids))) : [];
    return { s, history, names };
  });
  const { s } = d;
  const closed = d.history.filter((h) => h.c.day === day);
  const branch = ctx.branches.find((b) => b.id === ctx.branchId)?.name;
  return (
    <div>
      <PageHeader title="Daily close" eyebrow={branch} icon={<Wallet />} subtitle={`Takings and drawer count for ${day}`}
        actions={<><form className="print:hidden"><Toolbar className="mb-0"><Input type="date" name="day" defaultValue={day} max={today} className="w-40" aria-label="Day" /><button className="h-10 rounded border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3">Show</button></Toolbar></form>{can(ctx.user.role, "expenses.manage") && <LinkButton variant="secondary" href="/expenses" className="print:hidden">Expenses</LinkButton>}<PrintButton /></>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Sales" value={m(s.salesTotal)} sub={`${s.salesCount} sales · ${s.voidedCount} voided${s.offlineCount ? ` · ${s.offlineCount} offline` : ""}`} />
        <Kpi label="Cash expected in drawer" value={m(s.expected.cash)} tone="green" sub={`after ${m(s.expenses.cash)} cash expenses`} />
        <Kpi label="Mobile money expected" value={m(s.expected.mobile_money)} tone="blue" />
        <Kpi label="Credit given" value={m(s.creditGiven)} tone="yellow" sub={`${m(s.repaymentTotal)} repaid today`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Panel title="By payment method" bodyClassName="p-0">
            <Table head={["Method", "Taken", "Refunds", "Account repayments", "Expenses paid", "Expected"]}>
              {DRAWER_METHODS.map((k) => (
                <tr key={k}>
                  <Td>{METHOD_LABEL[k]}</Td><Td className="tabular-nums">{m(s.takings[k] + s.refunds[k])}</Td><Td className="tabular-nums text-muted">{s.refunds[k] ? `-${m(s.refunds[k])}` : "—"}</Td>
                  <Td className="tabular-nums text-muted">{s.repayments[k] ? m(s.repayments[k]) : "—"}</Td><Td className="tabular-nums text-muted">{s.expenses[k] ? `-${m(s.expenses[k])}` : "—"}</Td>
                  <Td className="font-semibold tabular-nums">{m(s.expected[k])}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          {s.payerPortion > 0 && <Panel><Dl items={[["Insurer / HMO share (to claim)", m(s.payerPortion)], ["Voided sales", `${s.voidedCount} · ${m(s.voidedTotal)}`]]} /></Panel>}
          <Panel title="By cashier" bodyClassName="p-0">
            <Table head={["Staff", "Sales", "Value", "Cash", "Mobile money", "Card", "Bank"]} empty={<EmptyState title="No sales on this day" compact />}>
              {s.perCashier.map((c) => (
                <tr key={c.userId ?? "none"}>
                  <Td>{d.names.find((n) => n.id === c.userId)?.name ?? "—"}</Td><Td className="tabular-nums">{c.sales}</Td><Td className="tabular-nums">{m(c.total)}</Td>
                  {DRAWER_METHODS.map((k) => <Td key={k} className="tabular-nums text-muted">{m(c.takings[k])}</Td>)}
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Closes" bodyClassName="p-0">
            <Table head={["Day", "By", "Expected cash", "Counted", "Variance", "Notes"]} empty={<EmptyState title="No closes yet" compact />}>
              {d.history.map(({ c, by }) => (
                <tr key={c.id}>
                  <Td>{c.day}<div className="text-xs text-muted">{dateTime(c.createdAt, tz)}</div></Td><Td>{by ?? "—"}</Td>
                  <Td className="tabular-nums">{m(c.expected.cash ?? 0)}</Td><Td className="tabular-nums">{m(c.countedCashMinor)}</Td>
                  <Td><Badge tone={c.varianceMinor === 0 ? "green" : c.varianceMinor < 0 ? "red" : "yellow"}>{c.varianceMinor === 0 ? "balanced" : `${c.varianceMinor < 0 ? "short" : "over"} ${m(Math.abs(c.varianceMinor))}`}</Badge></Td>
                  <Td className="whitespace-normal text-muted">{c.notes ?? ""}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
        <aside className="space-y-4 print:hidden lg:sticky lg:top-24 lg:self-start">
          <Panel title="Count the drawer" glow>
            {closed.length > 0 && <p className="mb-3 text-xs text-muted">Already closed {closed.length} time{closed.length === 1 ? "" : "s"} for this day; a new count is added to the history.</p>}
            {ctx.access === "full" ? (
              <ActionForm action={saveCashupAction}>
                <input type="hidden" name="day" value={day} />
                <Field label="Cash counted" hint={`Expected ${m(s.expected.cash)}`}><Input name="countedCash" inputMode="decimal" required className="h-12 text-right text-xl tabular-nums" /></Field>
                <Field label="Mobile money balance" hint={`Expected ${m(s.expected.mobile_money)}`}><Input name="countedMomo" inputMode="decimal" className="text-right tabular-nums" /></Field>
                <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Anything that explains a difference" /></Field>
                <Submit size="lg" className="w-full">Close the day</Submit>
              </ActionForm>
            ) : <p className="text-sm text-muted">This account is read-only.</p>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
