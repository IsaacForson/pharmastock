import { and, desc, eq, sql } from "drizzle-orm";
import { FileText, Mail, Pencil, Phone, Plus, Printer, ShoppingCart, Sparkles, Trash2, Truck, Wallet } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { A, Avatar, Badge, Dl, Field, Input, Kpi, LinkButton, Panel, Select, Table, Td } from "@/components/ui";
import { goodsReceipts, productUnits, products, purchaseOrders, supplierPayments, supplierPrices, supplierReturns, suppliers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { agingBucket, BUCKET_LABELS, BUCKETS, supplierBalances } from "@/lib/purchasing";
import { loadCatalog } from "../../purchasing/catalog";
import { PO_STATUS, RETURN_STATUS } from "../../purchasing/status";
import { deletePriceAction, recordPaymentAction } from "../actions";
import { PriceForm } from "../price-form";

export const metadata = { title: "Supplier" };

const METHODS = { bank: "Bank transfer", mobile_money: "Mobile money", cash: "Cash", card: "Card" } as const;

export default async function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  const ctx = await requireCtx("purchasing.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const today = localDay(ctx.tenant.timezone);
  const d = await tx(ctx, async (t) => {
    const [s] = await t.select().from(suppliers).where(eq(suppliers.id, id));
    if (!s) return null;
    const [prices, grns, returns, payments, pos, balances, catalog] = await Promise.all([
      t.select({ p: supplierPrices, name: products.name, strength: products.strength, unit: productUnits.name, factor: productUnits.factor, baseUnit: products.baseUnit })
        .from(supplierPrices).innerJoin(products, eq(products.id, supplierPrices.productId)).innerJoin(productUnits, eq(productUnits.id, supplierPrices.unitId))
        .where(eq(supplierPrices.supplierId, id)).orderBy(products.name),
      t.select().from(goodsReceipts).where(eq(goodsReceipts.supplierId, id)).orderBy(desc(goodsReceipts.receivedAt)).limit(50),
      t.select().from(supplierReturns).where(eq(supplierReturns.supplierId, id)).orderBy(desc(supplierReturns.createdAt)).limit(20),
      t.select().from(supplierPayments).where(eq(supplierPayments.supplierId, id)).orderBy(desc(supplierPayments.paidAt), desc(supplierPayments.createdAt)).limit(30),
      t.select().from(purchaseOrders).where(and(eq(purchaseOrders.supplierId, id), sql`${purchaseOrders.status} <> 'cancelled'`)).orderBy(desc(purchaseOrders.createdAt)).limit(10),
      supplierBalances(t, today, id),
      can(ctx.user.role, "purchasing.manage") ? loadCatalog(t, { branchId: ctx.branchId }) : Promise.resolve([]),
    ]);
    return { s, prices, grns, returns, payments, pos, bal: balances.get(id), catalog };
  });
  if (!d) notFound();
  const { s, bal } = d;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const open = d.grns.filter((g) => g.totalMinor > g.paidMinor);
  const canPay = can(ctx.user.role, "supplier.payments");

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel glow>
          <div className="flex items-center gap-4">
            <Avatar name={s.name} size="lg" />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">Supplier</div>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{s.name}</h1>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {!s.active && <Badge>Inactive</Badge>}
                <Badge tone="blue">{s.paymentTermsDays ? `Pay in ${s.paymentTermsDays} days` : "Pay on delivery"}</Badge>
                <Badge tone="teal">{s.leadTimeDays}-day delivery</Badge>
              </div>
            </div>
          </div>
          <div className="mt-5">
            <Dl cols={1} items={[
              ["Contact", s.contactName],
              ["WhatsApp", s.phone ? <a key="p" href={`tel:${s.phone}`} className="inline-flex items-center gap-1.5 hover:text-accent"><Phone className="h-3.5 w-3.5" aria-hidden />{s.phone}</a> : null],
              ["Email", s.email ? <a key="e" href={`mailto:${s.email}`} className="inline-flex items-center gap-1.5 hover:text-accent"><Mail className="h-3.5 w-3.5" aria-hidden />{s.email}</a> : null],
              ["Licence no.", s.licenceNo],
              ["Address", s.address],
              ["Returns", `At least ${s.returnMinDaysToExpiry} days to expiry${s.returnWithinDaysOfDelivery ? `, within ${s.returnWithinDaysOfDelivery} days of delivery` : ""}`],
            ]} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <LinkButton href={`/purchasing/new?supplier=${s.id}`} size="sm"><ShoppingCart className="h-3.5 w-3.5" aria-hidden />New order</LinkButton>
            <LinkButton href={`/purchasing/reorder?supplier=${s.id}`} size="sm" variant="secondary"><Sparkles className="h-3.5 w-3.5" aria-hidden />Reorder</LinkButton>
            <LinkButton href={`/suppliers/${s.id}/statement`} size="sm" variant="secondary"><Printer className="h-3.5 w-3.5" aria-hidden />Statement</LinkButton>
            {can(ctx.user.role, "suppliers.manage") && <LinkButton href={`/suppliers/${s.id}/edit`} size="sm" variant="ghost"><Pencil className="h-3.5 w-3.5" aria-hidden />Edit</LinkButton>}
          </div>
        </Panel>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi label="You owe" value={money(bal?.owedMinor ?? 0, cur)} tone="teal" icon={<Wallet />} sub={bal?.nextDue ? `next due ${dateOnly(bal.nextDue, "UTC")}` : undefined} />
            <Kpi label="Overdue" value={money(bal?.overdueMinor ?? 0, cur)} tone={bal?.overdueMinor ? "red" : "green"} icon={<Wallet />} />
            <Kpi label="Deliveries" value={d.grns.length} icon={<Truck />} sub={d.grns[0] ? `last ${dateOnly(d.grns[0].receivedAt, tz)}` : "none yet"} />
          </div>
          <Panel title="Aging" eyebrow="What you owe, by how late it is">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {BUCKETS.map((b) => (
                <div key={b} className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">{BUCKET_LABELS[b]}</div>
                  <div className={`mt-1 text-lg font-semibold tabular-nums ${b !== "current" && (bal?.buckets[b] ?? 0) > 0 ? "text-bad" : "text-fg"}`}>{money(bal?.buckets[b] ?? 0, cur)}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">Deliveries minus payments and credit notes. Due dates come from the payment terms when the delivery was received.</p>
          </Panel>
          {canPay && (
            <Panel title="Record a payment" icon={<Wallet />}>
              <ActionForm action={recordPaymentAction} resetOnSuccess>
                <input type="hidden" name="supplierId" value={s.id} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Amount"><Input name="amount" inputMode="decimal" required placeholder="0.00" /></Field>
                  <Field label="Paid by"><Select name="method" defaultValue="bank">{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <Field label="Date"><Input name="paidAt" type="date" defaultValue={today} max={today} required /></Field>
                  <Field label="Against" className="sm:col-span-2">
                    <Select name="receiptId" defaultValue="">
                      <option value="">Oldest deliveries first</option>
                      {open.map((g) => <option key={g.id} value={g.id}>{g.grnNo}{g.supplierInvoiceNo ? ` · inv ${g.supplierInvoiceNo}` : ""} · {money(g.totalMinor - g.paidMinor, cur)} left</option>)}
                    </Select>
                  </Field>
                  <Field label="Reference"><Input name="reference" placeholder="Transfer / MoMo ref" /></Field>
                </div>
                <div className="flex justify-end"><Submit>Record payment</Submit></div>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Deliveries" eyebrow="Goods received" icon={<Truck />}>
          <Table head={["GRN", "Invoice", "Received", "Due", "Total", "Unpaid"]} empty="No deliveries yet">
            {d.grns.map((g) => {
              const left = g.totalMinor - g.paidMinor;
              const late = left > 0 && agingBucket(g.dueAt, today) !== "current";
              return (
                <tr key={g.id}>
                  <Td><A href={`/receiving/${g.id}`} className="font-mono text-xs">{g.grnNo}</A></Td>
                  <Td className="text-muted">{g.supplierInvoiceNo ?? "—"}</Td>
                  <Td className="text-muted">{dateOnly(g.receivedAt, tz)}</Td>
                  <Td className={late ? "font-medium text-bad" : "text-muted"}>{g.dueAt ? dateOnly(g.dueAt, "UTC") : "—"}</Td>
                  <Td className="tabular-nums">{money(g.totalMinor, cur)}</Td>
                  <Td className="tabular-nums">{left > 0 ? money(left, cur) : <Badge tone="green">Paid</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        </Panel>
        <Panel title="Payments" icon={<Wallet />}>
          <Table head={["Date", "Method", "Reference", "Against", "Amount"]} empty="No payments recorded">
            {d.payments.map((p) => (
              <tr key={p.id}>
                <Td className="text-muted">{dateOnly(p.paidAt, "UTC")}</Td>
                <Td>{METHODS[p.method as keyof typeof METHODS] ?? p.method}</Td>
                <Td className="text-muted">{p.reference ?? "—"}</Td>
                <Td className="font-mono text-xs text-muted">{d.grns.find((g) => g.id === p.receiptId)?.grnNo ?? (p.receiptId ? "earlier GRN" : "advance")}</Td>
                <Td className="text-right tabular-nums">{money(p.amountMinor, cur)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Price list" eyebrow={`${d.prices.length} products`} icon={<FileText />}>
          <Table head={["Product", "Pack", "Cost", "Per unit", "Updated", ""]} empty="No prices yet. They're added when you receive deliveries, or below.">
            {d.prices.map(({ p, name, strength, unit, factor, baseUnit }) => (
              <tr key={`${p.productId}${p.unitId}`}>
                <Td className="font-medium">{name}{strength && <span className="text-muted"> {strength}</span>}{p.supplierCode && <span className="ml-2 font-mono text-xs text-subtle">{p.supplierCode}</span>}</Td>
                <Td className="text-muted">{unit}</Td>
                <Td className="tabular-nums">{money(p.costMinor, cur)}</Td>
                <Td className="tabular-nums text-muted">{money(p.costMinor / factor, cur)}/{baseUnit}</Td>
                <Td className="text-xs text-muted">{dateOnly(p.updatedAt, tz)} · {p.source}</Td>
                <Td><ActionButton action={deletePriceAction} fields={{ supplierId: s.id, productId: p.productId, unitId: p.unitId }} variant="ghost" confirm="Remove this price?"><Trash2 className="h-3.5 w-3.5" aria-label="Remove price" /></ActionButton></Td>
              </tr>
            ))}
          </Table>
          <div className="mt-5 border-t border-line pt-5">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-fg"><Plus className="h-4 w-4" aria-hidden />Add or update a price</div>
            <PriceForm supplierId={s.id} catalog={d.catalog} />
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Orders" icon={<ShoppingCart />} actions={<A href={`/purchasing/new?supplier=${s.id}`} className="text-sm">New order</A>}>
            <Table head={["Order", "Status", "Created", "Total"]} empty="No orders yet">
              {d.pos.map((po) => (
                <tr key={po.id}>
                  <Td><A href={`/purchasing/${po.id}`} className="font-mono text-xs">{po.poNo}</A></Td>
                  <Td><Badge tone={PO_STATUS[po.status].tone}>{PO_STATUS[po.status].label}</Badge></Td>
                  <Td className="text-muted">{dateOnly(po.createdAt, tz)}</Td>
                  <Td className="tabular-nums">{money(po.totalMinor, cur)}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Returns" icon={<Truck />} actions={<A href="/returns" className="text-sm">Returns calendar</A>}>
            <Table head={["Return", "Status", "Sent", "Value", "Credited"]} empty="No returns to this supplier">
              {d.returns.map((r) => (
                <tr key={r.id}>
                  <Td><A href={`/returns/${r.id}`} className="font-mono text-xs">{r.returnNo}</A></Td>
                  <Td><Badge tone={RETURN_STATUS[r.status]?.tone ?? "gray"}>{RETURN_STATUS[r.status]?.label ?? r.status}</Badge></Td>
                  <Td className="text-muted">{dateOnly(r.createdAt, tz)}</Td>
                  <Td className="tabular-nums">{money(r.valueMinor, cur)}</Td>
                  <Td className="tabular-nums">{r.creditedAt ? money(r.creditedMinor, cur) : "—"}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
      </div>
    </div>
  );
}
