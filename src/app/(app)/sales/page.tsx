import { outer } from "@/db";
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { Receipt, ScanLine, Search } from "lucide-react";
import Link from "next/link";
import { Badge, EmptyState, Input, Kpi, LinkButton, PageHeader, Panel, Select, Table, Td, Toolbar } from "@/components/ui";
import { STATUS_TONE } from "./status";
import { customers, payments, sales, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dayRange, localDay, money, timeOnly } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/receipt";

export const metadata = { title: "Sales" };

const STATUSES = ["completed", "partially_returned", "returned", "voided"] as const;
const METHODS = ["cash", "mobile_money", "card", "bank", "insurance", "loyalty"] as const;

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const ctx = await requireCtx("pos.sell");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const tz = ctx.tenant.timezone;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str("day")) ? str("day") : localDay(tz);
  const { start, end } = dayRange(day, tz);
  const cashier = /^[0-9a-f-]{36}$/.test(str("cashier")) ? str("cashier") : "";
  const method = (METHODS as readonly string[]).includes(str("method")) ? str("method") : "";
  const status = (STATUSES as readonly string[]).includes(str("status")) ? (str("status") as (typeof STATUSES)[number]) : "";
  const offline = str("offline") === "1";
  const q = str("q").trim().toUpperCase();
  const cur = ctx.tenant.currency;

  const data = await tx(ctx, async (t) => {
    const conds: SQL[] = [eq(sales.branchId, ctx.branchId)];
    if (q) conds.push(sql`${sales.saleNo} ilike ${"%" + q.replace(/[%_\\]/g, "") + "%"}`);
    else conds.push(gte(sales.soldAt, start), lt(sales.soldAt, end));
    if (cashier) conds.push(eq(sales.cashierId, cashier));
    if (status) conds.push(eq(sales.status, status));
    if (offline) conds.push(eq(sales.offline, true));
    if (method) conds.push(sql`exists (select 1 from ${payments} where ${payments.saleId} = ${outer(sales.id)} and ${payments.method} = ${method})`);
    const rows = await t.select({ s: sales, customer: customers.name, cashier: users.name }).from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId)).leftJoin(users, eq(users.id, sales.cashierId))
      .where(and(...conds)).orderBy(desc(sales.soldAt)).limit(300);
    const pays = rows.length ? await t.select({ saleId: payments.saleId, method: payments.method }).from(payments).where(inArray(payments.saleId, rows.map((r) => r.s.id))) : [];
    const staff = await t.select({ id: users.id, name: users.name }).from(users).orderBy(users.name);
    return { rows, pays, staff };
  });
  const methodsOf = (id: string) => [...new Set(data.pays.filter((p) => p.saleId === id && p.method !== "insurance").map((p) => p.method))];
  const live = data.rows.filter((r) => r.s.status !== "voided");
  const total = live.reduce((s, r) => s + r.s.totalMinor, 0);

  return (
    <div>
      <PageHeader title="Sales" eyebrow="Today" icon={<Receipt />} subtitle={q ? `Searching for ${q}` : `Sales on ${day} at this branch`}
        actions={<LinkButton href="/pos"><ScanLine className="h-4 w-4" aria-hidden /> New sale</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Sales" value={live.length} sub={`${data.rows.length - live.length} voided`} />
        <Kpi label="Takings" value={money(total, cur)} tone="green" />
        <Kpi label="Average sale" value={money(live.length ? Math.round(total / live.length) : 0, cur)} tone="blue" />
        <Kpi label="Sold offline" value={data.rows.filter((r) => r.s.offline).length} tone="yellow" />
      </div>
      <form>
        <Toolbar>
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={str("q")} placeholder="Sale number" className="pl-9" aria-label="Sale number" />
          </div>
          <Input type="date" name="day" defaultValue={day} className="w-40" aria-label="Day" />
          <Select name="cashier" defaultValue={cashier} className="w-44" aria-label="Cashier"><option value="">All staff</option>{data.staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Select name="method" defaultValue={method} className="w-40" aria-label="Payment method"><option value="">Any payment</option>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</Select>
          <Select name="status" defaultValue={status} className="w-44" aria-label="Status"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="offline" value="1" defaultChecked={offline} /> Offline only</label>
          <button className="h-10 rounded border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3">Filter</button>
        </Toolbar>
      </form>
      <Panel bodyClassName="p-0">
        <Table head={["Sale", "Time", "Customer", "Cashier", "Paid by", "Total", "Status"]} empty={<EmptyState title="No sales match" compact>Change the day or filters, or open the till to make a sale.</EmptyState>}>
          {data.rows.map(({ s, customer, cashier: by }) => (
            <tr key={s.id} className="hover:bg-surface-2">
              <Td><Link href={`/sales/${s.id}`} className="font-mono text-xs font-semibold text-accent hover:underline">{s.saleNo}</Link></Td>
              <Td className="tabular-nums text-muted">{timeOnly(s.soldAt, tz)}</Td>
              <Td>{customer ?? <span className="text-subtle">Walk-in</span>}</Td>
              <Td className="text-muted">{by ?? "—"}</Td>
              <Td className="text-muted">{methodsOf(s.id).map((m) => METHOD_LABEL[m]).join(", ") || (s.creditMinor ? "On account" : "—")}</Td>
              <Td className="text-right font-medium tabular-nums">{money(s.totalMinor, cur)}</Td>
              <Td><span className="flex gap-1"><Badge tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ")}</Badge>{s.offline && <Badge tone="yellow">offline</Badge>}</span></Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </div>
  );
}
