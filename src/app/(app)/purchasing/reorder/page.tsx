import { asc, eq, inArray } from "drizzle-orm";
import { CalendarRange, PackageSearch, Sparkles, TrendingUp } from "lucide-react";
import { Kpi, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { productUnits, supplierPrices, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { forecastDetails, forecastMonth } from "@/lib/forecast";
import { localDay, money } from "@/lib/format";
import { reorderSuggestions } from "@/lib/reorder";
import { ReorderTable } from "./reorder-table";

export const metadata = { title: "What to reorder" };

export default async function ReorderPage({ searchParams }: PageProps<"/purchasing/reorder">) {
  const ctx = await requireCtx("purchasing.manage");
  const sp = await searchParams;
  const seasonal = sp.seasonal !== "0";
  const filterSupplier = typeof sp.supplier === "string" && /^[0-9a-f-]{36}$/.test(sp.supplier) ? sp.supplier : undefined;
  const d = await tx(ctx, async (t) => {
    const details = await forecastDetails(t, ctx.tenant, ctx.branchId);
    const factors = new Map(details.filter((x) => x.factor !== 1).map((x) => [x.productId, x.factor]));
    const rows = await reorderSuggestions(t, { tenant: ctx.tenant, branchId: ctx.branchId, seasonal: seasonal ? factors : undefined, supplierId: filterSupplier });
    const ids = rows.map((r) => r.productId);
    const quotes = ids.length ? await t.select({ supplierId: supplierPrices.supplierId, productId: supplierPrices.productId, unitId: supplierPrices.unitId, costMinor: supplierPrices.costMinor, updatedAt: supplierPrices.updatedAt, factor: productUnits.factor, unitName: productUnits.name })
      .from(supplierPrices).innerJoin(productUnits, eq(productUnits.id, supplierPrices.unitId)).where(inArray(supplierPrices.productId, ids)) : [];
    const units = ids.length ? await t.select({ id: productUnits.id, productId: productUnits.productId, name: productUnits.name, factor: productUnits.factor }).from(productUnits).where(inArray(productUnits.productId, ids)) : [];
    const sups = await t.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name));
    return { rows, details: details.filter((x) => ids.includes(x.productId)), seasonalCount: factors.size, quotes: quotes.map((q) => ({ ...q, updatedAt: q.updatedAt.toISOString() })), units, sups };
  });
  const est = d.rows.reduce((s, r) => s + (r.estCostMinor ?? 0), 0);
  const out = d.rows.filter((r) => r.reason === "out_of_stock").length;
  const month = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${forecastMonth(localDay(ctx.tenant.timezone))}-01T00:00:00Z`));
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ seasonal: seasonal ? undefined : "0", supplier: filterSupplier, ...o }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader eyebrow="Purchasing" title="What to reorder" icon={<Sparkles />}
        subtitle={`From the last 8 weeks of sales at this branch, stock on hand and orders already placed${seasonal ? `, adjusted for ${month}` : ""}.`}
        actions={<LinkButton href="/purchasing" variant="secondary">All orders</LinkButton>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="To reorder" value={d.rows.length} icon={<PackageSearch />} sub="products" />
        <Kpi label="Out of stock" value={out} tone={out ? "red" : "green"} icon={<PackageSearch />} />
        <Kpi label="Estimated cost" value={money(est, ctx.tenant.currency)} tone="teal" icon={<TrendingUp />} sub="at known supplier prices" />
        <Kpi label="Seasonal adjustments" value={d.seasonalCount} tone="yellow" icon={<CalendarRange />} sub={seasonal ? `forecast for ${month}` : "switched off"} />
      </div>
      <Tabs current={seasonal ? "on" : "off"} tabs={[
        { key: "on", href: `/purchasing/reorder${q({ seasonal: undefined })}`, label: "With seasonal forecast" },
        { key: "off", href: `/purchasing/reorder${q({ seasonal: "0" })}`, label: "Recent sales only" },
      ]} />
      <ReorderTable rows={d.rows} details={d.details} quotes={d.quotes} units={d.units} suppliers={d.sups} currency={ctx.tenant.currency} filterSupplier={filterSupplier} />
    </>
  );
}
