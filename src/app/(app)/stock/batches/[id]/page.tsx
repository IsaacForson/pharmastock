import { asc, desc, eq } from "drizzle-orm";
import { ArrowLeftRight, Ban, ClipboardCheck, History, PackageMinus, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { A, Badge, Callout, Dl, Field, Input, LinkButton, PageHeader, Panel, Select, Table, Td } from "@/components/ui";
import { branches, productUnits, products, stockBatches, stockMovements, suppliers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { EXPIRY_BADGE, expiryState, packs } from "@/lib/catalog";
import { dateOnly, dateTime, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { adjustBatchAction, quarantineAction } from "../../actions";
import { MOVE_LABEL } from "../../labels";

export const metadata = { title: "Batch" };

export default async function BatchPage({ params }: PageProps<"/stock/batches/[id]">) {
  const ctx = await requireCtx("stock.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await tx(ctx, async (t) => {
    const [row] = await t.select({ b: stockBatches, p: products, supplier: suppliers.name, branch: branches.name }).from(stockBatches)
      .innerJoin(products, eq(products.id, stockBatches.productId)).innerJoin(branches, eq(branches.id, stockBatches.branchId))
      .leftJoin(suppliers, eq(suppliers.id, stockBatches.supplierId)).where(eq(stockBatches.id, id));
    if (!row) return null;
    const [units, moves] = await Promise.all([
      t.select().from(productUnits).where(eq(productUnits.productId, row.p.id)).orderBy(asc(productUnits.factor)),
      t.select({ m: stockMovements, user: users.name }).from(stockMovements).leftJoin(users, eq(users.id, stockMovements.userId))
        .where(eq(stockMovements.batchId, id)).orderBy(desc(stockMovements.createdAt)).limit(200),
    ]);
    return { ...row, units, moves };
  });
  if (!data || !ctx.branches.some((b) => b.id === data.b.branchId)) notFound();
  const { b, p, units, moves } = data;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone, today = localDay(tz);
  const st = EXPIRY_BADGE[expiryState(b.expiry, today)];
  const here = b.branchId === ctx.branchId;
  const canAdjust = here && can(ctx.user.role, "stock.adjust");
  const controlled = p.schedule === "controlled";
  const canDestroy = !controlled || can(ctx.user.role, "controlled.destroy");
  // Running balance shown next to each movement (newest first), counted back from the current quantity.
  const ledger = moves.map(({ m, user }, i) => ({ m, user, after: b.qtyOnHand - moves.slice(0, i).reduce((s, x) => s + x.m.qty, 0) }));
  const unitPicker = (
    <Field label="Counted in">
      <Select name="factor" defaultValue="1">
        {units.map((u) => <option key={u.id} value={u.factor}>{u.name}{u.factor > 1 ? ` (${u.factor})` : ""}</option>)}
        {!units.some((u) => u.factor === 1) && <option value="1">{p.baseUnit}</option>}
      </Select>
    </Field>
  );
  const witness = controlled && <Field label="Witness name" hint="Required for the controlled-drug register"><Input name="witness" required /></Field>;

  return (
    <>
      <PageHeader title={<>{p.name} <span className="text-muted">{p.strength}</span></>} eyebrow={`Batch ${b.batchNo || "without number"} · ${data.branch}`} icon={<PackageMinus />}
        actions={<>
          <LinkButton href={`/products/${p.id}`} variant="secondary">Product</LinkButton>
          {here && hasFeature(ctx.tenant, "transfers") && can(ctx.user.role, "stock.transfer") && b.qtyOnHand > 0 && <LinkButton href={`/transfers/new?batch=${b.id}`} variant="secondary"><ArrowLeftRight className="h-4 w-4" />Transfer</LinkButton>}
        </>} />

      {b.quarantined && <div className="mb-6"><Callout tone="red" icon={<ShieldAlert />}>Quarantined: {b.quarantineReason}. It can&apos;t be sold until it&apos;s released.</Callout></div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Batch" icon={<ClipboardCheck />}>
            <Dl cols={3} items={[
              ["On hand", <span key="q" className="tabular-nums">{packs(b.qtyOnHand, units, p.baseUnit)} <span className="text-muted">({b.qtyOnHand} {p.baseUnit})</span></span>],
              ["Expiry", <span key="e">{b.expiry ? dateOnly(b.expiry, tz) : "None"} <Badge tone={st.tone}>{st.word}</Badge></span>],
              ["Value at cost", money(Math.round(b.qtyOnHand * b.unitCostMinor), cur)],
              ["Cost per unit", money(Math.round(b.unitCostMinor * 100) / 100, cur)],
              ["Supplier", data.supplier ?? ""],
              ["Received", dateOnly(b.receivedAt, tz)],
            ]} />
          </Panel>

          <Panel title="Movement ledger" eyebrow="Every change to this batch" icon={<History />}>
            <Table head={["When", "What", "Change", "Balance", "Ref", "Reason", "By"]} empty="No movements">
              {ledger.map(({ m, user, after }) => (
                <tr key={m.id}>
                  <Td className="text-muted">{dateTime(m.createdAt, tz)}</Td>
                  <Td>{MOVE_LABEL[m.type]}</Td>
                  <Td className={m.qty < 0 ? "tabular-nums text-bad" : "tabular-nums text-ok"}>{m.qty > 0 ? "+" : ""}{m.qty}</Td>
                  <Td className="tabular-nums">{after}</Td>
                  <Td className="font-mono text-xs text-muted">{m.ref ?? ""}</Td>
                  <Td className="max-w-64 truncate text-muted">{m.reason ?? ""}</Td>
                  <Td className="text-muted">{user ?? ""}</Td>
                </tr>
              ))}
            </Table>
            {moves.length === 200 && <p className="mt-3 text-xs text-subtle">Showing the latest 200 movements. <A href={`/stock/movements?product=${p.id}`}>See all</A></p>}
          </Panel>
        </div>

        {canAdjust ? (
          <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <Panel title="Count correction" icon={<ClipboardCheck />} eyebrow="The shelf has a different amount">
              <ActionForm action={adjustBatchAction} resetOnSuccess>
                <input type="hidden" name="batchId" value={b.id} /><input type="hidden" name="kind" value="count" />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Actually on shelf"><Input name="qty" type="number" min={0} required /></Field>
                  {unitPicker}
                </div>
                <Field label="Note (optional)"><Input name="reason" placeholder="Recounted after delivery" /></Field>
                <div className="flex justify-end"><Submit variant="secondary">Save count</Submit></div>
              </ActionForm>
            </Panel>

            {canDestroy && b.qtyOnHand > 0 && (
              <Panel title="Remove damaged or expired" icon={<Ban />}>
                <ActionForm action={adjustBatchAction} resetOnSuccess>
                  <input type="hidden" name="batchId" value={b.id} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Why"><Select name="kind" defaultValue={st.word === "Expired" ? "expire" : "damage"}><option value="damage">Damaged</option><option value="expire">Expired</option></Select></Field>
                    <Field label="How many"><Input name="qty" type="number" min={1} defaultValue={st.word === "Expired" ? b.qtyOnHand : undefined} required /></Field>
                  </div>
                  {unitPicker}
                  <Field label="Note (optional)"><Input name="reason" placeholder="Broken bottle" /></Field>
                  {witness}
                  <div className="flex justify-end"><Submit variant="danger">Write off</Submit></div>
                </ActionForm>
              </Panel>
            )}

            <Panel title="Other correction" icon={<Wrench />} eyebrow="Plus to add, minus to remove">
              <ActionForm action={adjustBatchAction} resetOnSuccess>
                <input type="hidden" name="batchId" value={b.id} /><input type="hidden" name="kind" value="correct" /><input type="hidden" name="factor" value="1" />
                <Field label={`Change (${p.baseUnit})`}><Input name="qty" type="number" required placeholder="-2" /></Field>
                <Field label="Reason"><Input name="reason" required placeholder="Wrong quantity keyed at receiving" /></Field>
                <div className="flex justify-end"><Submit variant="secondary">Apply</Submit></div>
              </ActionForm>
            </Panel>

            <Panel title={b.quarantined ? "Release from quarantine" : "Quarantine"} icon={b.quarantined ? <ShieldCheck /> : <ShieldAlert />} eyebrow="Stops sales without changing stock">
              <ActionForm action={quarantineAction}>
                <input type="hidden" name="batchId" value={b.id} />
                {b.quarantined ? <Field label="Note (optional)"><Input name="reason" placeholder="Cleared by supplier" /></Field>
                  : <><input type="hidden" name="quarantine" value="on" /><Field label="Reason"><Input name="reason" required placeholder="Recall notice, damaged seal…" /></Field></>}
                <div className="flex justify-end"><Submit variant={b.quarantined ? "secondary" : "danger"}>{b.quarantined ? "Release batch" : "Quarantine batch"}</Submit></div>
              </ActionForm>
            </Panel>
          </div>
        ) : (
          <Panel><p className="text-sm text-muted">{here ? "You can view this batch. Ask a pharmacist or manager to adjust it." : "Switch to this batch's branch to adjust it."}</p></Panel>
        )}
      </div>
    </>
  );
}
