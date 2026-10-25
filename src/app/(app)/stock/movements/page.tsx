import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { History } from "lucide-react";
import { A, Button, Field, Input, PageHeader, Panel, Select, Table, Td, Toolbar } from "@/components/ui";
import { products, stockBatches, stockMovements, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime, dayRange, money } from "@/lib/format";
import { MOVE_LABEL, MOVE_TYPES } from "../labels";
import { StockTabs } from "../tabs";

export const metadata = { title: "Stock movements" };
const PER_PAGE = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function MovementsPage({ searchParams }: PageProps<"/stock/movements">) {
  const ctx = await requireCtx("stock.view");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const type = MOVE_TYPES.includes(one("type") as never) ? (one("type") as (typeof MOVE_TYPES)[number]) : "";
  const from = DAY.test(one("from")) ? one("from") : "", to = DAY.test(one("to")) ? one("to") : "";
  const product = /^[0-9a-f-]{36}$/i.test(one("product")) ? one("product") : "";
  const q = one("q").trim().slice(0, 80), page = Math.max(1, Number(one("page")) || 1);
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;

  const { rows, total } = await tx(ctx, async (t) => {
    const where: (SQL | undefined)[] = [
      eq(stockMovements.branchId, ctx.branchId),
      type ? eq(stockMovements.type, type) : undefined,
      from ? gte(stockMovements.createdAt, dayRange(from, tz).start) : undefined,
      to ? lt(stockMovements.createdAt, dayRange(to, tz).end) : undefined,
      product ? eq(stockMovements.productId, product) : undefined,
      q ? or(ilike(products.name, `%${q}%`), ilike(stockMovements.ref, `%${q}%`)) : undefined,
    ];
    const [rows, [c]] = await Promise.all([
      t.select({ m: stockMovements, name: products.name, strength: products.strength, batchNo: stockBatches.batchNo, user: users.name }).from(stockMovements)
        .innerJoin(products, eq(products.id, stockMovements.productId)).leftJoin(stockBatches, eq(stockBatches.id, stockMovements.batchId))
        .leftJoin(users, eq(users.id, stockMovements.userId)).where(and(...where))
        .orderBy(desc(stockMovements.createdAt)).limit(PER_PAGE).offset((page - 1) * PER_PAGE),
      t.select({ n: sql<number>`count(*)::int` }).from(stockMovements).innerJoin(products, eq(products.id, stockMovements.productId)).where(and(...where)),
    ]);
    return { rows, total: c.n };
  });
  const href = (o: Record<string, string>) => `/stock/movements?${new URLSearchParams({ ...(type && { type }), ...(from && { from }), ...(to && { to }), ...(product && { product }), ...(q && { q }), ...o })}`;

  return (
    <>
      <PageHeader title="Stock movements" eyebrow="Stock" icon={<History />} subtitle={`${total} movement${total === 1 ? "" : "s"} at this branch`} />
      <StockTabs current="movements" />
      <form action="/stock/movements">
        <Toolbar className="items-end">
          {product && <input type="hidden" name="product" value={product} />}
          <Field label="Product or ref" className="min-w-52 flex-1"><Input name="q" defaultValue={q} placeholder="Paracetamol, GRN-000012…" /></Field>
          <Field label="Type">
            <Select name="type" defaultValue={type} className="w-48">
              <option value="">All types</option>
              {MOVE_TYPES.map((k) => <option key={k} value={k}>{MOVE_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" name="from" defaultValue={from} /></Field>
          <Field label="To"><Input type="date" name="to" defaultValue={to} /></Field>
          <Button variant="secondary">Filter</Button>
          {(product || type || from || to || q) && <A href="/stock/movements" className="pb-2.5 text-sm">Clear</A>}
        </Toolbar>
      </form>
      <Panel>
        <Table head={["When", "Product", "Batch", "What", "Qty", "Value", "Ref", "Reason", "By"]} empty="No movements match">
          {rows.map(({ m, name, strength, batchNo, user }) => (
            <tr key={m.id}>
              <Td className="text-muted">{dateTime(m.createdAt, tz)}</Td>
              <Td><A href={`/products/${m.productId}`}>{name}</A> <span className="text-xs text-muted">{strength}</span></Td>
              <Td className="font-mono text-xs">{m.batchId ? <A href={`/stock/batches/${m.batchId}`}>{batchNo || "—"}</A> : "—"}</Td>
              <Td>{MOVE_LABEL[m.type]}</Td>
              <Td className={m.qty < 0 ? "tabular-nums text-bad" : "tabular-nums text-ok"}>{m.qty > 0 ? "+" : ""}{m.qty}</Td>
              <Td className="tabular-nums text-muted">{money(Math.round(m.qty * m.unitCostMinor), cur)}</Td>
              <Td className="font-mono text-xs text-muted">{m.ref ?? ""}</Td>
              <Td className="max-w-56 truncate text-muted">{m.reason ?? ""}</Td>
              <Td className="text-muted">{user ?? ""}</Td>
            </tr>
          ))}
        </Table>
        {total > PER_PAGE && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>Page {page} of {Math.ceil(total / PER_PAGE)}</span>
            <span className="flex gap-3">
              {page > 1 && <A href={href({ page: String(page - 1) })}>Previous</A>}
              {page * PER_PAGE < total && <A href={href({ page: String(page + 1) })}>Next</A>}
            </span>
          </div>
        )}
      </Panel>
    </>
  );
}
