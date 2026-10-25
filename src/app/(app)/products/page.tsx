import { outer } from "@/db";
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { Barcode, FileUp, Pill, Plus, Search, Star } from "lucide-react";
import Link from "next/link";
import { A, Badge, Button, Input, LinkButton, PageHeader, Panel, Segmented, Select, Table, Td, Toolbar } from "@/components/ui";
import { SCHEDULE_TONE } from "./form-data";
import { barcodes, categories, productUnits, products, stockBatches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { packs } from "@/lib/catalog";
import { rulesFor } from "@/lib/compliance";
import { money } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Products" };
const PER_PAGE = 50;

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const ctx = await requireCtx("stock.view");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const q = one("q").trim().slice(0, 80), cat = one("cat"), sched = one("sched"), show = one("show") || "active";
  const page = Math.max(1, Number(one("page")) || 1);
  const labels = rulesFor(ctx.tenant.country).scheduleLabels;

  const { rows, total, cats, units } = await tx(ctx, async (t) => {
    const stock = t.select({ productId: stockBatches.productId, qty: sql<number>`sum(${stockBatches.qtyOnHand})::int`.as("qty") })
      .from(stockBatches).where(eq(stockBatches.branchId, ctx.branchId)).groupBy(stockBatches.productId).as("s");
    const onHand = sql<number>`coalesce(${stock.qty}, 0)`;
    const where: (SQL | undefined)[] = [
      show === "inactive" ? eq(products.active, false) : eq(products.active, true),
      show === "low" ? sql`${onHand} > 0 and ${onHand} <= ${products.reorderLevel}` : undefined,
      show === "out" ? sql`${onHand} = 0` : undefined,
      show === "favorites" ? eq(products.favorite, true) : undefined,
      cat && /^[0-9a-f-]{36}$/i.test(cat) ? eq(products.categoryId, cat) : undefined,
      sched && sched in labels ? eq(products.schedule, sched as "otc") : undefined,
      q ? or(ilike(products.name, `%${q}%`), ilike(products.genericName, `%${q}%`), ilike(products.manufacturer, `%${q}%`),
        sql`exists (select 1 from ${barcodes} where ${barcodes.productId} = ${outer(products.id)} and ${barcodes.code} = ${q})`) : undefined,
    ];
    const base = t.select({ p: products, category: categories.name, onHand: sql<number>`${onHand}::int` }).from(products)
      .leftJoin(stock, eq(stock.productId, products.id)).leftJoin(categories, eq(categories.id, products.categoryId)).where(and(...where));
    const [rows, [{ n }], cats] = await Promise.all([
      base.orderBy(asc(products.name)).limit(PER_PAGE).offset((page - 1) * PER_PAGE),
      t.select({ n: sql<number>`count(*)::int` }).from(products).leftJoin(stock, eq(stock.productId, products.id)).where(and(...where)),
      t.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    ]);
    const units = rows.length ? await t.select().from(productUnits).where(inArray(productUnits.productId, rows.map((r) => r.p.id))) : [];
    return { rows, total: n, cats, units };
  });

  const href = (o: Record<string, string>) => {
    const u = new URLSearchParams({ ...(q && { q }), ...(cat && { cat }), ...(sched && { sched }), show, ...o });
    if (u.get("show") === "active") u.delete("show");
    return `/products?${u}`;
  };
  const canWrite = can(ctx.user.role, "products.write");

  return (
    <>
      <PageHeader title="Products" eyebrow="Catalogue" icon={<Pill />} subtitle={`${total} ${show === "inactive" ? "inactive" : ""} product${total === 1 ? "" : "s"} · stock shown for this branch`}
        actions={<>
          <LinkButton href="/products/labels" variant="secondary"><Barcode className="h-4 w-4" />Labels</LinkButton>
          {canWrite && <LinkButton href="/products/import" variant="secondary"><FileUp className="h-4 w-4" />Import</LinkButton>}
          {canWrite && <LinkButton href="/products/new"><Plus className="h-4 w-4" />Add product</LinkButton>}
        </>} />

      <Segmented current={show} tabs={[
        { key: "active", label: "Active", href: href({ show: "active", page: "1" }) },
        { key: "low", label: "Low stock", href: href({ show: "low", page: "1" }) },
        { key: "out", label: "Out of stock", href: href({ show: "out", page: "1" }) },
        { key: "favorites", label: "Quick keys", href: href({ show: "favorites", page: "1" }) },
        { key: "inactive", label: "Inactive", href: href({ show: "inactive", page: "1" }) },
      ]} />

      <form action="/products">
        <Toolbar>
          <input type="hidden" name="show" value={show} />
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search name, generic, maker or scan a barcode" className="pl-9" aria-label="Search products" />
          </div>
          <Select name="cat" defaultValue={cat} className="w-48" aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select name="sched" defaultValue={sched} className="w-52" aria-label="Schedule">
            <option value="">All schedules</option>
            {Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Button variant="secondary">Filter</Button>
        </Toolbar>
      </form>

      <Panel>
        <Table head={["Product", "Schedule", "Category", "On hand", "Price", "Shelf"]} empty={q ? `Nothing matches "${q}"` : "No products here yet"}>
          {rows.map(({ p, category, onHand }) => {
            const us = units.filter((u) => u.productId === p.id);
            const def = us.find((u) => u.isDefault) ?? us[0];
            const low = p.reorderLevel > 0 && onHand <= p.reorderLevel;
            return (
              <tr key={p.id}>
                <Td>
                  <Link href={`/products/${p.id}`} className="group block">
                    <span className="flex items-center gap-1.5 font-medium text-fg group-hover:text-accent">{p.name}{p.favorite && <Star className="h-3.5 w-3.5 text-warn" aria-label="Quick key" />}</span>
                    <span className="block text-xs text-muted">{[p.strength, p.form, p.genericName].filter(Boolean).join(" · ") || "—"}</span>
                  </Link>
                </Td>
                <Td><Badge tone={SCHEDULE_TONE[p.schedule]}>{labels[p.schedule]}</Badge></Td>
                <Td className="text-muted">{category ?? "—"}</Td>
                <Td className="tabular-nums">
                  {onHand === 0 ? <Badge tone="red">Out of stock</Badge> : <span className={low ? "text-warn" : ""}>{packs(onHand, us, p.baseUnit)}{low && <span className="ml-2 text-xs">low</span>}</span>}
                </Td>
                <Td className="tabular-nums">{def ? <>{money(def.sellPriceMinor, ctx.tenant.currency)} <span className="text-xs text-muted">/ {def.name}</span></> : "—"}</Td>
                <Td className="font-mono text-xs text-muted">{p.shelf ?? ""}</Td>
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
