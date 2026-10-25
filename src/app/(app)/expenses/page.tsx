import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Banknote } from "lucide-react";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { EmptyState, Field, Input, Kpi, PageHeader, Panel, Select, Table, Td, Toolbar } from "@/components/ui";
import { expenses, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, localDay, money } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/receipt";
import { addExpenseAction, deleteExpenseAction } from "./actions";

export const metadata = { title: "Expenses" };

const CATEGORIES = ["Rent", "Electricity", "Water", "Internet & phone", "Salaries", "Transport", "Cleaning", "Repairs", "Licences & fees", "Bank charges", "Stationery", "Food & refreshments", "Other"];

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const ctx = await requireCtx("expenses.manage");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const today = localDay(tz);
  const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDay(sp.from) ? sp.from : addDays(today, -29);
  const to = isDay(sp.to) ? sp.to : today;
  const cat = typeof sp.category === "string" && CATEGORIES.includes(sp.category) ? sp.category : "";
  const d = await tx(ctx, async (t) => {
    const where = and(eq(expenses.branchId, ctx.branchId), gte(expenses.day, from), lte(expenses.day, to), cat ? eq(expenses.category, cat) : undefined);
    const rows = await t.select({ e: expenses, by: users.name }).from(expenses).leftJoin(users, eq(users.id, expenses.createdBy)).where(where).orderBy(desc(expenses.day), desc(expenses.createdAt)).limit(300);
    const byCat = await t.select({ category: expenses.category, total: sql<number>`sum(${expenses.amountMinor})::int` }).from(expenses).where(where).groupBy(expenses.category).orderBy(desc(sql`sum(${expenses.amountMinor})`));
    return { rows, byCat };
  });
  const total = d.byCat.reduce((s, c) => s + c.total, 0);
  return (
    <div>
      <PageHeader title="Expenses" eyebrow="Business" icon={<Banknote />} subtitle="Money paid out of the pharmacy. Cash expenses come off the drawer at the daily close." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={`Total ${from} to ${to}`} value={money(total, cur)} />
        {d.byCat.slice(0, 3).map((c) => <Kpi key={c.category} label={c.category} value={money(c.total, cur)} tone="blue" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <form><Toolbar>
            <Input type="date" name="from" defaultValue={from} className="w-40" aria-label="From" /><Input type="date" name="to" defaultValue={to} className="w-40" aria-label="To" />
            <Select name="category" defaultValue={cat} className="w-48" aria-label="Category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
            <button className="h-10 rounded border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3">Filter</button>
          </Toolbar></form>
          <Panel bodyClassName="p-0">
            <Table head={["Day", "Category", "Details", "Paid by", "Amount", ""]} empty={<EmptyState title="No expenses in this period" compact />}>
              {d.rows.map(({ e, by }) => (
                <tr key={e.id}>
                  <Td className="text-muted">{e.day}</Td><Td>{e.category}</Td>
                  <Td className="whitespace-normal">{[e.description, e.paidTo && `to ${e.paidTo}`].filter(Boolean).join(" · ") || "—"}<div className="text-xs text-subtle">{by}</div></Td>
                  <Td className="text-muted">{METHOD_LABEL[e.method]}</Td><Td className="font-medium tabular-nums">{money(e.amountMinor, cur)}</Td>
                  <Td>{e.day === today && ctx.access === "full" && <ActionButton action={deleteExpenseAction} fields={{ id: e.id }} variant="ghost" confirm="Remove this expense?">Remove</ActionButton>}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
        {ctx.access === "full" && (
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Panel title="Record an expense" glow>
              <ActionForm action={addExpenseAction} resetOnSuccess>
                <Field label="Category"><Select name="category" required defaultValue="">{[<option key="" value="" disabled>Choose…</option>, ...CATEGORIES.map((c) => <option key={c}>{c}</option>)]}</Select></Field>
                <Field label="Amount"><Input name="amount" inputMode="decimal" required className="text-right tabular-nums" /></Field>
                <Field label="Paid from"><Select name="method" defaultValue="cash"><option value="cash">Cash drawer</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="bank">Bank</option></Select></Field>
                <Field label="Paid to"><Input name="paidTo" /></Field>
                <Field label="Details"><Input name="description" /></Field>
                <Field label="Date"><Input name="day" type="date" defaultValue={today} max={today} required /></Field>
                <Submit className="w-full">Save expense</Submit>
              </ActionForm>
            </Panel>
          </aside>
        )}
      </div>
    </div>
  );
}
