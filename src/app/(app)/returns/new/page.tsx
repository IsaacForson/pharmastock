import { and, asc, eq, gt, ilike, inArray, sql } from "drizzle-orm";
import { Search, Undo2 } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { A, Badge, Callout, Field, Input, PageHeader, Panel, Select, Table, Td, Textarea, Toolbar } from "@/components/ui";
import { products, stockBatches, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, localDay, money } from "@/lib/format";
import { RETURN_REASONS } from "@/lib/purchasing";
import { createReturnAction } from "../actions";

export const metadata = { title: "New supplier return" };

const uuid = /^[0-9a-f-]{36}$/;

export default async function NewReturnPage({ searchParams }: PageProps<"/returns/new">) {
  const ctx = await requireCtx("purchasing.manage");
  const sp = await searchParams;
  const ids = [sp.batch].flat().filter((x): x is string => typeof x === "string" && uuid.test(x)).slice(0, 200);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const today = localDay(ctx.tenant.timezone);
  const cur = ctx.tenant.currency;
  const cols = { b: stockBatches, name: products.name, strength: products.strength, schedule: products.schedule, baseUnit: products.baseUnit, supplier: suppliers.name };
  const d = await tx(ctx, async (t) => {
    const base = t.select(cols).from(stockBatches).innerJoin(products, eq(products.id, stockBatches.productId)).leftJoin(suppliers, eq(suppliers.id, stockBatches.supplierId));
    if (ids.length) {
      return {
        picked: await base.where(and(inArray(stockBatches.id, ids), eq(stockBatches.branchId, ctx.branchId), gt(stockBatches.qtyOnHand, 0))).orderBy(asc(products.name)),
        sups: await t.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name)),
        all: [],
      };
    }
    return {
      picked: [], sups: [],
      all: await base.where(and(eq(stockBatches.branchId, ctx.branchId), gt(stockBatches.qtyOnHand, 0), q ? ilike(products.name, `%${q}%`) : undefined))
        .orderBy(sql`${stockBatches.expiry} asc nulls last`, asc(products.name)).limit(300),
    };
  });

  if (!ids.length) {
    return (
      <>
        <PageHeader eyebrow="Returns" title="Choose batches to return" icon={<Undo2 />} subtitle="Tick the batches going back to one supplier." />
        <Toolbar>
          <form className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search products" aria-label="Search products" className="pl-10" />
          </form>
        </Toolbar>
        <form action="/returns/new" method="get">
          <Panel actions={<button className="inline-flex h-10 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-on-accent">Continue</button>}>
            <Table head={["", "Product", "Batch", "Expiry", "Supplier", "On hand", "Value"]} empty="No stock found">
              {d.all.map(({ b, name, strength, supplier }) => (
                <tr key={b.id}>
                  <Td><input type="checkbox" name="batch" value={b.id} aria-label={`Return ${name} batch ${b.batchNo}`} className="h-4 w-4 accent-[var(--accent)]" /></Td>
                  <Td className="font-medium">{name} {strength}</Td>
                  <Td className="font-mono text-xs">{b.batchNo || "—"}</Td>
                  <Td>{b.expiry ? <span className={b.expiry < today ? "text-bad" : "text-muted"}>{dateOnly(b.expiry, "UTC")}</span> : "—"}</Td>
                  <Td className="text-muted">{supplier ?? "—"}</Td>
                  <Td className="tabular-nums">{b.qtyOnHand}</Td>
                  <Td className="tabular-nums">{money(b.qtyOnHand * b.unitCostMinor, cur)}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </form>
      </>
    );
  }

  const supplierIds = [...new Set(d.picked.map((r) => r.b.supplierId).filter(Boolean))];
  const anyExpired = d.picked.some((r) => r.b.expiry && r.b.expiry < today);
  const controlled = d.picked.some((r) => r.schedule === "controlled");
  return (
    <>
      <PageHeader eyebrow="Returns" title="New supplier return" icon={<Undo2 />} subtitle="Stock leaves the shelf when you save. Print the return note to send with the goods." />
      {d.picked.length === 0 ? (
        <Callout tone="yellow">Those batches have no stock left at this branch. <A href="/returns/new">Choose others</A>.</Callout>
      ) : supplierIds.length > 1 ? (
        <Callout tone="yellow">These batches came from {supplierIds.length} different suppliers. Make one return per supplier: <A href="/returns">go back to the calendar</A>.</Callout>
      ) : (
        <ActionForm action={createReturnAction} onSuccessHref="/returns/{id}" className="space-y-6">
          <Panel title="Batches" eyebrow={`${d.picked.length} batch${d.picked.length === 1 ? "" : "es"}`}>
            <Table head={["Product", "Batch", "Expiry", "On hand", "Return qty", "Cost each"]}>
              {d.picked.map(({ b, name, strength, baseUnit, schedule }) => (
                <tr key={b.id}>
                  <Td className="font-medium">{name} {strength}{schedule === "controlled" && <span className="ml-2"><Badge tone="purple">Controlled</Badge></span>}</Td>
                  <Td className="font-mono text-xs">{b.batchNo || "—"}</Td>
                  <Td>{b.expiry ? <span className={b.expiry < today ? "text-bad" : "text-muted"}>{dateOnly(b.expiry, "UTC")}</span> : "—"}</Td>
                  <Td className="tabular-nums">{b.qtyOnHand} {baseUnit}</Td>
                  <Td><Input name={`qty:${b.id}`} type="number" min={0} max={b.qtyOnHand} defaultValue={b.qtyOnHand} aria-label={`Quantity of ${name} to return`} className="h-9 w-28 tabular-nums" /></Td>
                  <Td className="tabular-nums text-muted">{money(b.unitCostMinor, cur)}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Return details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Supplier">
                <Select name="supplierId" defaultValue={supplierIds[0] ?? ""} required>
                  <option value="">Choose a supplier…</option>
                  {d.sups.filter((s) => !supplierIds.length || supplierIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Reason">
                <Select name="reason" defaultValue={anyExpired ? "expired" : "near_expiry"}>
                  {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} placeholder="Agreed with the rep, collection date…" /></Field>
            </div>
            {controlled && <p className="mt-3 text-sm text-muted">Controlled drugs are entered in the register as returned to this supplier, with the supplier&apos;s name and address.</p>}
            <div className="mt-4 flex justify-end"><Submit size="lg">Save return and take off stock</Submit></div>
          </Panel>
        </ActionForm>
      )}
    </>
  );
}
