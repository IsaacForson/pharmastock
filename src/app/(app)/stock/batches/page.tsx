import { and, asc, eq, gt, ilike, or, sql, type SQL } from "drizzle-orm";
import { Boxes, Search } from "lucide-react";
import { A, Badge, Button, Input, PageHeader, Panel, Segmented, Table, Td, Toolbar } from "@/components/ui";
import { products, stockBatches, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { EXPIRY_BADGE, expiryState, sqlToday } from "@/lib/catalog";
import { dateOnly, localDay, money } from "@/lib/format";
import { StockTabs } from "../tabs";

export const metadata = { title: "Batches" };
const PER_PAGE = 100;

export default async function BatchesPage({ searchParams }: PageProps<"/stock/batches">) {
  const ctx = await requireCtx("stock.view");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = one("q").trim().slice(0, 80), show = one("show") || "all", page = Math.max(1, Number(one("page")) || 1);
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone, today = localDay(tz);

  const { rows, total } = await tx(ctx, async (t) => {
    const where: (SQL | undefined)[] = [
      eq(stockBatches.branchId, ctx.branchId),
      show === "empty" ? eq(stockBatches.qtyOnHand, 0) : gt(stockBatches.qtyOnHand, 0),
      show === "near" ? sql`${stockBatches.expiry} >= ${sqlToday} and ${stockBatches.expiry} <= ${sqlToday} + 90` : undefined,
      show === "expired" ? sql`${stockBatches.expiry} < ${sqlToday}` : undefined,
      show === "quarantined" ? eq(stockBatches.quarantined, true) : undefined,
      q ? or(ilike(products.name, `%${q}%`), ilike(products.genericName, `%${q}%`), ilike(stockBatches.batchNo, `%${q}%`)) : undefined,
    ];
    const [rows, [c]] = await Promise.all([
      t.select({ b: stockBatches, name: products.name, strength: products.strength, baseUnit: products.baseUnit, supplier: suppliers.name }).from(stockBatches)
        .innerJoin(products, eq(products.id, stockBatches.productId)).leftJoin(suppliers, eq(suppliers.id, stockBatches.supplierId))
        .where(and(...where)).orderBy(sql`${stockBatches.expiry} asc nulls last`, asc(products.name)).limit(PER_PAGE).offset((page - 1) * PER_PAGE),
      t.select({ n: sql<number>`count(*)::int` }).from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId)).where(and(...where)),
    ]);
    return { rows, total: c.n };
  });
  const href = (o: Record<string, string>) => `/stock/batches?${new URLSearchParams({ ...(q && { q }), show, ...o })}`;
  const f = (key: string, label: string) => ({ key, label, href: href({ show: key, page: "1" }) });

  return (
    <>
      <PageHeader title="Batches" eyebrow="Stock" icon={<Boxes />} subtitle="Every batch on the shelf at this branch, soonest expiry first." />
      <StockTabs current="batches" />
      <form action="/stock/batches">
        <Toolbar>
          <input type="hidden" name="show" value={show} />
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Product or batch number" className="pl-9" aria-label="Search batches" />
          </div>
          <Button variant="secondary">Search</Button>
        </Toolbar>
      </form>
      <Segmented current={show} tabs={[f("all", "In stock"), f("near", "Expiring in 90 days"), f("expired", "Expired"), f("quarantined", "Quarantined"), f("empty", "Used up")]} />
      <Panel>
        <Table head={["Product", "Batch", "Expiry", "Qty", "Cost / unit", "Value", "Supplier", "Status"]} empty="No batches here">
          {rows.map(({ b, name, strength, baseUnit, supplier }) => {
            const st = EXPIRY_BADGE[expiryState(b.expiry, today)];
            return (
              <tr key={b.id}>
                <Td><A href={`/stock/batches/${b.id}`}>{name}</A> <span className="text-xs text-muted">{strength}</span></Td>
                <Td className="font-mono text-xs">{b.batchNo || "—"}</Td>
                <Td>{b.expiry ? dateOnly(b.expiry, tz) : "—"}</Td>
                <Td className="tabular-nums">{b.qtyOnHand} <span className="text-xs text-muted">{baseUnit}</span></Td>
                <Td className="tabular-nums">{money(Math.round(b.unitCostMinor), cur)}</Td>
                <Td className="tabular-nums">{money(Math.round(b.qtyOnHand * b.unitCostMinor), cur)}</Td>
                <Td className="text-muted">{supplier ?? "—"}</Td>
                <Td className="space-x-1"><Badge tone={st.tone}>{st.word}</Badge>{b.quarantined && <Badge tone="red">Quarantined</Badge>}</Td>
              </tr>
            );
          })}
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
