import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { ArrowLeftRight, Barcode, Boxes, CalendarClock, History, Layers, Pencil, Pill, Tag, Truck, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { A, Badge, Dl, Kpi, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { barcodes, branches, categories, priceChanges, productUnits, products, stockBatches, stockMovements, supplierPrices, suppliers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { EXPIRY_BADGE, expiryState, packs } from "@/lib/catalog";
import { rulesFor } from "@/lib/compliance";
import { dateOnly, dateTime, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { SCHEDULE_TONE } from "../form-data";
import { MOVE_LABEL } from "../../stock/labels";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/products/[id]">) {
  const ctx = await requireCtx("stock.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const branchIds = ctx.branches.map((b) => b.id);
  const data = await tx(ctx, async (t) => {
    const [row] = await t.select({ p: products, category: categories.name, supplier: suppliers.name }).from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId)).leftJoin(suppliers, eq(suppliers.id, products.preferredSupplierId))
      .where(eq(products.id, id));
    if (!row) return null;
    const [units, codes, batches, moves, sprices, prices] = await Promise.all([
      t.select().from(productUnits).where(eq(productUnits.productId, id)).orderBy(productUnits.factor),
      t.select().from(barcodes).where(eq(barcodes.productId, id)),
      t.select({ b: stockBatches, branch: branches.name, supplier: suppliers.name }).from(stockBatches)
        .innerJoin(branches, eq(branches.id, stockBatches.branchId)).leftJoin(suppliers, eq(suppliers.id, stockBatches.supplierId))
        .where(and(eq(stockBatches.productId, id), inArray(stockBatches.branchId, branchIds), gt(stockBatches.qtyOnHand, 0)))
        .orderBy(branches.name, stockBatches.expiry),
      t.select({ m: stockMovements, user: users.name }).from(stockMovements).leftJoin(users, eq(users.id, stockMovements.userId))
        .where(and(eq(stockMovements.productId, id), eq(stockMovements.branchId, ctx.branchId))).orderBy(desc(stockMovements.createdAt)).limit(40),
      t.select({ sp: supplierPrices, supplier: suppliers.name, unit: productUnits.name, factor: productUnits.factor }).from(supplierPrices)
        .innerJoin(suppliers, eq(suppliers.id, supplierPrices.supplierId)).innerJoin(productUnits, eq(productUnits.id, supplierPrices.unitId))
        .where(eq(supplierPrices.productId, id)).orderBy(supplierPrices.costMinor),
      t.select({ c: priceChanges, unit: productUnits.name, user: users.name }).from(priceChanges)
        .innerJoin(productUnits, eq(productUnits.id, priceChanges.unitId)).leftJoin(users, eq(users.id, priceChanges.changedBy))
        .where(eq(priceChanges.productId, id)).orderBy(desc(priceChanges.createdAt)).limit(20),
    ]);
    return { ...row, units, codes, batches, moves, sprices, prices };
  });
  if (!data) notFound();
  const { p, units, codes, batches, moves, sprices, prices } = data;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone, today = localDay(tz);
  const labels = rulesFor(ctx.tenant.country).scheduleLabels;
  const here = batches.filter((x) => x.b.branchId === ctx.branchId).map((x) => x.b);
  const onHandHere = here.reduce((s, b) => s + b.qtyOnHand, 0);
  const sellable = here.filter((b) => !b.quarantined && (!b.expiry || b.expiry >= today));
  const sellableQty = sellable.reduce((s, b) => s + b.qtyOnHand, 0);
  const value = Math.round(here.reduce((s, b) => s + b.qtyOnHand * b.unitCostMinor, 0));
  const nextExpiry = sellable.map((b) => b.expiry).filter(Boolean).sort()[0] ?? null;
  const def = units.find((u) => u.isDefault) ?? units[0];
  const margin = can(ctx.user.role, "reports.margin");

  return (
    <>
      <PageHeader title={<>{p.name} {p.strength && <span className="text-muted">{p.strength}</span>}</>} eyebrow={data.category ?? "Product"} icon={<Pill />}
        subtitle={[p.genericName, p.form, p.manufacturer].filter(Boolean).join(" · ") || undefined}
        actions={<>
          {can(ctx.user.role, "stock.transfer") && here.length > 0 && ctx.branches.length > 1 && <LinkButton href="/transfers/new" variant="secondary"><ArrowLeftRight className="h-4 w-4" />Transfer</LinkButton>}
          <LinkButton href={`/products/labels?p=${p.id}`} variant="secondary"><Barcode className="h-4 w-4" />Print labels</LinkButton>
          {can(ctx.user.role, "products.write") && <LinkButton href={`/products/${p.id}/edit`}><Pencil className="h-4 w-4" />Edit</LinkButton>}
        </>} />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone={SCHEDULE_TONE[p.schedule]}>{labels[p.schedule]}</Badge>
        {!p.active && <Badge tone="gray">Inactive</Badge>}
        {p.favorite && <Badge tone="purple">Till quick key</Badge>}
        {p.shelf && <Badge tone="teal">Shelf {p.shelf}</Badge>}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="On hand here" value={packs(onHandHere, units, p.baseUnit)} sub={`${onHandHere} ${p.baseUnit}`} icon={<Boxes />} tone={onHandHere ? "teal" : "red"} />
        <Kpi label="Sellable" value={packs(sellableQty, units, p.baseUnit)} sub={onHandHere - sellableQty ? `${onHandHere - sellableQty} expired or quarantined` : "all in date"} icon={<Layers />} tone={onHandHere - sellableQty ? "yellow" : "green"} />
        <Kpi label="Value at cost" value={money(value, cur)} icon={<Wallet />} />
        <Kpi label="Next expiry" value={nextExpiry ? dateOnly(nextExpiry, tz) : "—"} sub={nextExpiry ? EXPIRY_BADGE[expiryState(nextExpiry, today)].word : undefined} icon={<CalendarClock />} tone={nextExpiry && expiryState(nextExpiry, today) !== "ok" ? "yellow" : "purple"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Batches" eyebrow={ctx.branches.length > 1 ? "All your branches" : "This branch"} icon={<Boxes />}>
            <Table head={["Branch", "Batch", "Expiry", "Qty", "Cost / unit", "Supplier", ""]} empty="No stock">
              {batches.map(({ b, branch, supplier }) => {
                const st = EXPIRY_BADGE[expiryState(b.expiry, today)];
                return (
                  <tr key={b.id}>
                    <Td className="text-muted">{branch}</Td>
                    <Td className="font-mono text-xs"><A href={`/stock/batches/${b.id}`}>{b.batchNo || "no batch no."}</A></Td>
                    <Td>{b.expiry ? dateOnly(b.expiry, tz) : "—"} <Badge tone={st.tone}>{st.word}</Badge></Td>
                    <Td className="tabular-nums">{packs(b.qtyOnHand, units, p.baseUnit)}</Td>
                    <Td className="tabular-nums">{money(Math.round(b.unitCostMinor), cur)}</Td>
                    <Td className="text-muted">{supplier ?? "—"}</Td>
                    <Td>{b.quarantined && <Badge tone="red">Quarantined</Badge>}</Td>
                  </tr>
                );
              })}
            </Table>
          </Panel>

          <Panel title="Stock movements" eyebrow="This branch · latest 40" icon={<History />} actions={<A href={`/stock/movements?product=${p.id}`} className="text-sm">All movements</A>}>
            <Table head={["When", "What", "Qty", "Ref", "Reason", "By"]} empty="No movements yet">
              {moves.map(({ m, user }) => (
                <tr key={m.id}>
                  <Td className="text-muted">{dateTime(m.createdAt, tz)}</Td>
                  <Td>{MOVE_LABEL[m.type]}</Td>
                  <Td className={m.qty < 0 ? "tabular-nums text-bad" : "tabular-nums text-ok"}>{m.qty > 0 ? "+" : ""}{m.qty}</Td>
                  <Td className="font-mono text-xs text-muted">{m.ref ?? ""}</Td>
                  <Td className="max-w-60 truncate text-muted">{m.reason ?? ""}</Td>
                  <Td className="text-muted">{user ?? ""}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Pack sizes" icon={<Tag />}>
            <ul className="space-y-3">
              {units.map((u) => (
                <li key={u.id} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fg">{u.name} <span className="text-xs text-muted">× {u.factor} {p.baseUnit}</span></span>
                    <span className="tabular-nums text-fg">{money(u.sellPriceMinor, cur)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {u.isDefault && <Badge tone="purple">Default</Badge>}
                    {!u.sellable && <Badge>Not sold at till</Badge>}
                    {codes.filter((c) => c.unitId === u.id).map((c) => <span key={c.id} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{c.code}</span>)}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Details" icon={<Pill />}>
            <Dl cols={1} items={[
              ["Tax", p.taxBp == null ? `Pharmacy default (${ctx.tenant.defaultTaxBp / 100}%)` : `${p.taxBp / 100}%`],
              ["Reorder below", p.reorderLevel ? `${p.reorderLevel} ${p.baseUnit}` : "Sales speed only"],
              ["Order quantity", p.reorderQty ? `${p.reorderQty} ${p.baseUnit}` : "Suggested"],
              ["Preferred supplier", data.supplier ?? ""],
            ]} />
          </Panel>

          <Panel title="Supplier prices" icon={<Truck />}>
            {sprices.length ? (
              <ul className="divide-y divide-line text-sm">
                {sprices.map(({ sp, supplier, unit, factor }) => (
                  <li key={`${sp.supplierId}${sp.unitId}`} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0"><Link href={`/suppliers/${sp.supplierId}`} className="block truncate font-medium text-fg hover:text-accent">{supplier}</Link>
                      <span className="text-xs text-muted">per {unit}{sp.supplierCode ? ` · code ${sp.supplierCode}` : ""} · {dateOnly(sp.updatedAt, tz)}</span></span>
                    <span className="text-right tabular-nums">{money(sp.costMinor, cur)}
                      {margin && def && def.factor === factor && def.sellPriceMinor > 0 && <span className="block text-xs text-muted">{Math.round(((def.sellPriceMinor - sp.costMinor) / def.sellPriceMinor) * 100)}% margin</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No supplier prices yet. Import a price list or receive a delivery.</p>}
          </Panel>

          <Panel title="Price history" icon={<History />}>
            {prices.length ? (
              <ul className="divide-y divide-line text-sm">
                {prices.map(({ c, unit, user }) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-xs text-muted">{dateTime(c.createdAt, tz)}<span className="block">{unit}{user ? ` · ${user}` : ""}</span></span>
                    <span className="tabular-nums"><span className="text-muted line-through">{money(c.oldPriceMinor, cur)}</span> → <span className={c.newPriceMinor > c.oldPriceMinor ? "text-warn" : "text-ok"}>{money(c.newPriceMinor, cur)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Price hasn&apos;t changed since it was set up.</p>}
          </Panel>
        </div>
      </div>
    </>
  );
}
