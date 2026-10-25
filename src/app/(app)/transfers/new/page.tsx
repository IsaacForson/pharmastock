import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import { ArrowLeftRight } from "lucide-react";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { branches, productUnits, products, stockBatches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { packs, sqlToday } from "@/lib/catalog";
import { hasFeature } from "@/lib/plans";
import { ChainOnly } from "../chain-only";
import { TransferForm, type StockItem } from "./transfer-form";

export const metadata = { title: "Send stock" };

export default async function NewTransferPage({ searchParams }: PageProps<"/transfers/new">) {
  const ctx = await requireCtx("stock.transfer");
  if (!hasFeature(ctx.tenant, "transfers")) return <ChainOnly />;
  const sp = await searchParams;
  const batch = typeof sp.batch === "string" && /^[0-9a-f-]{36}$/.test(sp.batch) ? sp.batch : null;
  // shortcut: sends every sendable batch at the branch to the browser; fine for a few thousand batches, page it if branches grow past that.
  const { dests, rows, units } = await tx(ctx, async (t) => {
    const dests = await t.select({ id: branches.id, name: branches.name }).from(branches)
      .where(and(eq(branches.active, true), ne(branches.id, ctx.branchId))).orderBy(asc(branches.name));
    const rows = await t.select({ b: stockBatches, name: products.name, strength: products.strength, baseUnit: products.baseUnit })
      .from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId))
      .where(and(eq(stockBatches.branchId, ctx.branchId), gt(stockBatches.qtyOnHand, 0), eq(stockBatches.quarantined, false),
        sql`(${stockBatches.expiry} is null or ${stockBatches.expiry} >= ${sqlToday})`))
      .orderBy(asc(products.name), sql`${stockBatches.expiry} asc nulls last`);
    const units = rows.length ? await t.select({ productId: productUnits.productId, name: productUnits.name, factor: productUnits.factor }).from(productUnits)
      .where(sql`${productUnits.productId} in (select distinct ${stockBatches.productId} from ${stockBatches} where ${stockBatches.branchId} = ${ctx.branchId} and ${stockBatches.qtyOnHand} > 0)`) : [];
    return { dests, rows, units };
  });
  const items = new Map<string, StockItem>();
  for (const r of rows) {
    const it = items.get(r.b.productId) ?? { id: r.b.productId, label: [r.name, r.strength].filter(Boolean).join(" "), baseUnit: r.baseUnit, onHand: 0, onHandText: "",
      units: units.filter((u) => u.productId === r.b.productId && u.factor > 1).map((u) => ({ name: u.name, factor: u.factor })), batches: [] };
    it.onHand += r.b.qtyOnHand;
    it.batches.push({ id: r.b.id, batchNo: r.b.batchNo, expiry: r.b.expiry, qty: r.b.qtyOnHand });
    items.set(it.id, it);
  }
  for (const it of items.values()) it.onHandText = packs(it.onHand, it.units, it.baseUnit);
  const pre = batch ? rows.find((r) => r.b.id === batch)?.b : undefined;
  return (
    <>
      <PageHeader title="Send stock" eyebrow="Transfers" icon={<ArrowLeftRight />} subtitle={`From ${ctx.branches.find((b) => b.id === ctx.branchId)?.name ?? "this branch"}. Batch numbers and expiry dates travel with the stock.`} />
      {!dests.length ? <EmptyState icon={<ArrowLeftRight />} title="No other branch to send to">Add a branch in Settings first.</EmptyState>
        : !items.size ? <EmptyState icon={<ArrowLeftRight />} title="Nothing to send">This branch has no sellable stock right now.</EmptyState>
        : <Panel><TransferForm branches={dests} items={[...items.values()]} preselect={pre ? { productId: pre.productId, batchId: pre.id } : null} /></Panel>}
    </>
  );
}
