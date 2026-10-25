import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { AlertTriangle, Boxes, Building2, CalendarClock, PackageX, Search, Wallet } from "lucide-react";
import Link from "next/link";
import { A, Badge, Button, Input, Kpi, LinkButton, PageHeader, Panel, Segmented, Table, Td, Toolbar } from "@/components/ui";
import { productUnits, products, stockBatches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { EXPIRY_BADGE, expiryState, packs, sqlToday } from "@/lib/catalog";
import { dateOnly, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { StockTabs } from "./tabs";

export const metadata = { title: "Stock" };
const PER_PAGE = 50;

export default async function StockPage({ searchParams }: PageProps<"/stock">) {
  const ctx = await requireCtx("stock.view");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = one("q").trim().slice(0, 80), show = one("show") || "all", page = Math.max(1, Number(one("page")) || 1);
  const consolidated = one("view") === "branches" && hasFeature(ctx.tenant, "consolidated") && ctx.branches.length > 1 && can(ctx.user.role, "reports.view");
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone, today = localDay(tz);
  const branchIds = consolidated ? ctx.branches.map((b) => b.id) : [ctx.branchId];

  const data = await tx(ctx, async (t) => {
    const value = sql`${stockBatches.qtyOnHand} * ${stockBatches.unitCostMinor}`;
    const s = t.select({
      productId: stockBatches.productId,
      onHand: sql<number>`sum(${stockBatches.qtyOnHand})::int`.as("on_hand"),
      sellable: sql<number>`coalesce(sum(${stockBatches.qtyOnHand}) filter (where not ${stockBatches.quarantined} and (${stockBatches.expiry} is null or ${stockBatches.expiry} >= ${sqlToday})), 0)::int`.as("sellable"),
      value: sql<number>`coalesce(sum(${value}), 0)::float`.as("value"),
      expiredValue: sql<number>`coalesce(sum(${value}) filter (where ${stockBatches.expiry} < ${sqlToday}), 0)::float`.as("expired_value"),
      nearValue: sql<number>`coalesce(sum(${value}) filter (where ${stockBatches.expiry} >= ${sqlToday} and ${stockBatches.expiry} <= ${sqlToday} + 90), 0)::float`.as("near_value"),
      next: sql<string | null>`(min(${stockBatches.expiry}) filter (where ${stockBatches.qtyOnHand} > 0 and ${stockBatches.expiry} >= ${sqlToday}))::text`.as("next"),
      hadStock: sql<boolean>`true`.as("had_stock"),
    }).from(stockBatches).where(inArray(stockBatches.branchId, branchIds)).groupBy(stockBatches.productId).as("s");
    const onHand = sql`coalesce(${s.onHand}, 0)`;
    const where: (SQL | undefined)[] = [
      eq(products.active, true),
      q ? or(ilike(products.name, `%${q}%`), ilike(products.genericName, `%${q}%`)) : undefined,
      show === "all" ? sql`(${s.hadStock} or ${products.reorderLevel} > 0)` : undefined,
      show === "low" ? sql`${onHand} > 0 and ${onHand} <= ${products.reorderLevel}` : undefined,
      show === "out" ? sql`${onHand} = 0 and (${s.hadStock} or ${products.reorderLevel} > 0)` : undefined,
      show === "near" ? sql`${s.nearValue} > 0` : undefined,
      show === "expired" ? sql`${s.expiredValue} > 0` : undefined,
    ];
    const [rows, [count], [kpi]] = await Promise.all([
      t.select({ p: products, onHand: sql<number>`${onHand}::int`, sellable: sql<number>`coalesce(${s.sellable}, 0)::int`, value: sql<number>`coalesce(${s.value}, 0)::float`, next: s.next })
        .from(products).leftJoin(s, eq(s.productId, products.id)).where(and(...where)).orderBy(asc(products.name)).limit(PER_PAGE).offset((page - 1) * PER_PAGE),
      t.select({ n: sql<number>`count(*)::int` }).from(products).leftJoin(s, eq(s.productId, products.id)).where(and(...where)),
      t.select({
        value: sql<number>`coalesce(sum(${s.value}), 0)::float`, near: sql<number>`coalesce(sum(${s.nearValue}), 0)::float`,
        expired: sql<number>`coalesce(sum(${s.expiredValue}), 0)::float`,
        out: sql<number>`count(*) filter (where coalesce(${s.onHand}, 0) = 0 and (${s.hadStock} or ${products.reorderLevel} > 0))::int`,
      }).from(products).leftJoin(s, eq(s.productId, products.id)).where(eq(products.active, true)),
    ]);
    const ids = rows.map((r) => r.p.id);
    const [units, perBranch] = ids.length ? await Promise.all([
      t.select().from(productUnits).where(inArray(productUnits.productId, ids)),
      consolidated ? t.select({ productId: stockBatches.productId, branchId: stockBatches.branchId, qty: sql<number>`sum(${stockBatches.qtyOnHand})::int` })
        .from(stockBatches).where(and(inArray(stockBatches.productId, ids), inArray(stockBatches.branchId, branchIds))).groupBy(stockBatches.productId, stockBatches.branchId) : Promise.resolve([]),
    ]) : [[], []];
    return { rows, total: count.n, kpi, units, perBranch };
  });

  const href = (o: Record<string, string>) => {
    const u = new URLSearchParams({ ...(q && { q }), show, ...(consolidated && { view: "branches" }), ...o });
    return `/stock?${u}`;
  };
  const filter = (key: string, label: string) => ({ key, label, href: href({ show: key, page: "1" }) });

  return (
    <>
      <PageHeader title="Stock & batches" eyebrow={consolidated ? "All branches" : ctx.branches.find((b) => b.id === ctx.branchId)?.name} icon={<Boxes />}
        subtitle="What's on the shelf, what it's worth, and what's about to expire."
        actions={<>
          {hasFeature(ctx.tenant, "consolidated") && ctx.branches.length > 1 && can(ctx.user.role, "reports.view") && (
            <LinkButton variant="secondary" href={consolidated ? "/stock" : "/stock?view=branches"}><Building2 className="h-4 w-4" />{consolidated ? "This branch only" : "All branches"}</LinkButton>
          )}
          {can(ctx.user.role, "stock.take") && <LinkButton href="/stock/take">Start a stock take</LinkButton>}
        </>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Stock value at cost" value={money(Math.round(data.kpi.value), cur)} icon={<Wallet />} />
        <Kpi label="Expiring in 90 days" value={money(Math.round(data.kpi.near), cur)} icon={<CalendarClock />} tone="yellow" href={href({ show: "near", page: "1" })} />
        <Kpi label="Expired on shelf" value={money(Math.round(data.kpi.expired), cur)} icon={<AlertTriangle />} tone="red" href={href({ show: "expired", page: "1" })} />
        <Kpi label="Out of stock" value={data.kpi.out} sub="items" icon={<PackageX />} tone="red" href={href({ show: "out", page: "1" })} />
      </div>

      <StockTabs current="products" />

      <form action="/stock">
        <Toolbar>
          <input type="hidden" name="show" value={show} />
          {consolidated && <input type="hidden" name="view" value="branches" />}
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search products" className="pl-9" aria-label="Search products" />
          </div>
          <Button variant="secondary">Search</Button>
        </Toolbar>
      </form>
      <Segmented current={show} tabs={[filter("all", "In stock"), filter("low", "Low"), filter("out", "Out"), filter("near", "Expiring soon"), filter("expired", "Expired")]} />

      <Panel>
        <Table head={consolidated ? ["Product", ...ctx.branches.map((b) => b.name), "Total", "Value"] : ["Product", "On hand", "Sellable", "Value at cost", "Next expiry", "Reorder level"]} empty="Nothing to show here">
          {data.rows.map(({ p, onHand, sellable, value, next }) => {
            const us = data.units.filter((u) => u.productId === p.id);
            const name = (
              <Td>
                <Link href={`/products/${p.id}`} className="group block">
                  <span className="font-medium text-fg group-hover:text-accent">{p.name}</span>
                  <span className="block text-xs text-muted">{[p.strength, p.form].filter(Boolean).join(" · ") || p.baseUnit}</span>
                </Link>
              </Td>
            );
            if (consolidated) return (
              <tr key={p.id}>
                {name}
                {ctx.branches.map((b) => {
                  const n = data.perBranch.find((x) => x.productId === p.id && x.branchId === b.id)?.qty ?? 0;
                  return <Td key={b.id} className={n ? "tabular-nums" : "tabular-nums text-subtle"}>{packs(n, us, p.baseUnit)}</Td>;
                })}
                <Td className="tabular-nums font-medium">{packs(onHand, us, p.baseUnit)}</Td>
                <Td className="tabular-nums">{money(Math.round(value), cur)}</Td>
              </tr>
            );
            const st = EXPIRY_BADGE[expiryState(next, today)];
            const low = p.reorderLevel > 0 && onHand <= p.reorderLevel;
            return (
              <tr key={p.id}>
                {name}
                <Td className="tabular-nums">{onHand ? packs(onHand, us, p.baseUnit) : <Badge tone="red">Out of stock</Badge>}</Td>
                <Td className={sellable < onHand ? "tabular-nums text-warn" : "tabular-nums"}>{packs(sellable, us, p.baseUnit)}</Td>
                <Td className="tabular-nums">{money(Math.round(value), cur)}</Td>
                <Td>{next ? <span className="inline-flex items-center gap-2">{dateOnly(next, tz)} {st.word !== "In date" && <Badge tone={st.tone}>{st.word}</Badge>}</span> : <span className="text-subtle">—</span>}</Td>
                <Td>{p.reorderLevel ? <span className={low ? "text-warn" : "text-muted"}>{p.reorderLevel} {p.baseUnit}{low && " · low"}</span> : <span className="text-subtle">—</span>}</Td>
              </tr>
            );
          })}
        </Table>
        {data.total > PER_PAGE && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted">
            <span>Page {page} of {Math.ceil(data.total / PER_PAGE)}</span>
            <span className="flex gap-3">
              {page > 1 && <A href={href({ page: String(page - 1) })}>Previous</A>}
              {page * PER_PAGE < data.total && <A href={href({ page: String(page + 1) })}>Next</A>}
            </span>
          </div>
        )}
      </Panel>
    </>
  );
}
