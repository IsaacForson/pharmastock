import { and, desc, eq, inArray } from "drizzle-orm";
import { Bike, FileText, Printer, Receipt, Tag } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { A, Badge, Dl, Field, LinkButton, PageHeader, Panel, Select, Table, Td, Textarea, Timeline } from "@/components/ui";
import { auditLog, customers, deliveries, payers, payments, prescriptions, productUnits, products, saleLines, saleReturns, sales, stockBatches, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { METHOD_LABEL } from "@/lib/receipt";
import { returnSaleAction, voidSaleAction } from "../actions";
import { STATUS_TONE } from "../status";

export const metadata = { title: "Sale" };

export default async function SalePage({ params }: PageProps<"/sales/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx("pos.sell");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const d = await tx(ctx, async (t) => {
    const [s] = await t.select().from(sales).where(eq(sales.id, id));
    if (!s) return null;
    const lines = await t.select({ line: saleLines, product: products, unit: productUnits.name }).from(saleLines)
      .innerJoin(products, eq(products.id, saleLines.productId)).innerJoin(productUnits, eq(productUnits.id, saleLines.unitId)).where(eq(saleLines.saleId, id));
    const batchIds = [...new Set(lines.flatMap((l) => l.line.allocations.map((a) => a.batchId)))];
    const batches = batchIds.length ? await t.select().from(stockBatches).where(inArray(stockBatches.id, batchIds)) : [];
    const pays = await t.select({ p: payments, by: users.name }).from(payments).leftJoin(users, eq(users.id, payments.receivedBy)).where(eq(payments.saleId, id)).orderBy(payments.receivedAt);
    const returns = await t.select({ r: saleReturns, by: users.name }).from(saleReturns).leftJoin(users, eq(users.id, saleReturns.createdBy)).where(eq(saleReturns.saleId, id)).orderBy(saleReturns.createdAt);
    const people = [s.cashierId, s.pharmacistId, s.voidedBy].filter(Boolean) as string[];
    const staff = people.length ? await t.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, people)) : [];
    const [customer] = s.customerId ? await t.select().from(customers).where(eq(customers.id, s.customerId)) : [];
    const [payer] = s.payerId ? await t.select().from(payers).where(eq(payers.id, s.payerId)) : [];
    const [rx] = s.prescriptionId ? await t.select({ id: prescriptions.id, rxNo: prescriptions.rxNo }).from(prescriptions).where(eq(prescriptions.id, s.prescriptionId)) : [];
    const [delivery] = await t.select({ id: deliveries.id, status: deliveries.status }).from(deliveries).where(eq(deliveries.saleId, id)).limit(1);
    const log = can(ctx.user.role, "audit.view") || can(ctx.user.role, "pos.void")
      ? await t.select({ a: auditLog, by: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.userId))
        .where(and(eq(auditLog.entity, "sale"), eq(auditLog.entityId, id))).orderBy(desc(auditLog.at)).limit(30)
      : [];
    return { s, lines, batches, pays, returns, staff, customer, payer, rx, delivery, log };
  });
  if (!d) notFound();
  const { s } = d;
  const name = (uid: string | null) => d.staff.find((x) => x.id === uid)?.name ?? "—";
  const canVoid = ctx.access === "full" && can(ctx.user.role, "pos.void") && s.status === "completed" && localDay(tz, s.soldAt) === localDay(tz);
  const canReturn = ctx.access === "full" && can(ctx.user.role, "pos.return") && (s.status === "completed" || s.status === "partially_returned");
  const medicine = d.lines.some((l) => l.product.schedule !== "non_drug");
  const deliveryOn = hasFeature(ctx.tenant, "delivery") && can(ctx.user.role, "deliveries.manage");

  return (
    <div>
      <PageHeader title={<span className="font-mono">{s.saleNo}</span>} eyebrow="Sale" icon={<Receipt />}
        subtitle={<span className="flex flex-wrap items-center gap-2">{dateTime(s.soldAt, tz)} <Badge tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ")}</Badge>{s.offline && <Badge tone="yellow">offline</Badge>}</span>}
        actions={<>
          <LinkButton variant="secondary" href={`/sales/${s.id}/receipt`}><Printer className="h-4 w-4" aria-hidden /> Receipt</LinkButton>
          <LinkButton variant="secondary" href={`/sales/${s.id}/receipt?format=a4`}><FileText className="h-4 w-4" aria-hidden /> A4 invoice</LinkButton>
          {medicine && <LinkButton variant="secondary" href={`/sales/${s.id}/labels`}><Tag className="h-4 w-4" aria-hidden /> Labels</LinkButton>}
          {deliveryOn && s.status !== "voided" && (d.delivery
            ? <LinkButton variant="ghost" href="/deliveries"><Bike className="h-4 w-4" aria-hidden /> Delivery {d.delivery.status}</LinkButton>
            : <LinkButton variant="ghost" href={`/deliveries/new?sale=${s.id}`}><Bike className="h-4 w-4" aria-hidden /> Deliver</LinkButton>)}
        </>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel title="Items" bodyClassName="p-0">
            <Table head={["Item", "Qty", "Price", "Discount", "Total", "Batches used (FEFO)"]}>
              {d.lines.map(({ line, unit }) => (
                <tr key={line.id}>
                  <Td className="whitespace-normal">{line.description}{line.returnedBaseQty > 0 && <div className="text-xs text-warn">{line.returnedBaseQty} returned</div>}{line.shortBaseQty > 0 && <div className="text-xs text-bad">{line.shortBaseQty} sold short (offline)</div>}</Td>
                  <Td className="tabular-nums">{line.qty} × {unit}</Td>
                  <Td className="tabular-nums">{money(line.unitPriceMinor, cur)}</Td>
                  <Td className="tabular-nums text-muted">{line.discountMinor ? money(line.discountMinor, cur) : "—"}</Td>
                  <Td className="tabular-nums font-medium">{money(line.totalMinor, cur)}</Td>
                  <Td className="text-xs text-muted">{line.allocations.map((a) => { const b = d.batches.find((x) => x.id === a.batchId); return `${b?.batchNo || "—"}${b?.expiry ? ` exp ${b.expiry}` : ""} × ${a.qty}`; }).join(", ") || "—"}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          <Panel title="Payments" bodyClassName="p-0">
            <Table head={["Receipt", "Method", "Reference", "Amount", "Taken by", "When"]} empty={<p className="px-5 py-4 text-sm text-muted">{s.creditMinor ? "Sold on account." : "No payments."}</p>}>
              {d.pays.map(({ p, by }) => (
                <tr key={p.id}>
                  <Td className="font-mono text-xs text-muted">{p.receiptNo ?? "—"}</Td>
                  <Td>{METHOD_LABEL[p.method]}{p.status !== "succeeded" && <> <Badge tone="red">{p.status}</Badge></>}</Td>
                  <Td className="text-muted">{p.reference ?? "—"}</Td>
                  <Td className={p.amountMinor < 0 ? "tabular-nums text-bad" : "tabular-nums"}>{money(p.amountMinor, cur)}</Td>
                  <Td className="text-muted">{by ?? "—"}</Td>
                  <Td className="text-muted">{dateTime(p.receivedAt, tz)}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
          {d.returns.length > 0 && (
            <Panel title="Returns" bodyClassName="p-0">
              <Table head={["Return", "Reason", "Stock", "Refund", "By", "When"]}>
                {d.returns.map(({ r, by }) => (
                  <tr key={r.id}><Td className="font-mono text-xs">{r.returnNo}</Td><Td className="whitespace-normal">{r.reason}</Td><Td>{r.restock ? "Back on shelf" : "Written off"}</Td>
                    <Td className="tabular-nums">{money(r.refundMinor, cur)} · {METHOD_LABEL[r.refundMethod]}</Td><Td className="text-muted">{by ?? "—"}</Td><Td className="text-muted">{dateTime(r.createdAt, tz)}</Td></tr>
                ))}
              </Table>
            </Panel>
          )}
          {canReturn && (
            <Panel title="Return items" eyebrow="Customer return">
              <ActionForm action={returnSaleAction}>
                <input type="hidden" name="saleId" value={s.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  {d.lines.filter(({ line }) => line.baseQty > line.returnedBaseQty).map(({ line, product }) => (
                    <Field key={line.id} label={`${line.description}`} hint={`Up to ${line.baseQty - line.returnedBaseQty} ${product.baseUnit}`}>
                      <input name={`qty_${line.id}`} type="number" min={0} max={line.baseQty - line.returnedBaseQty} placeholder="0" className="h-10 w-full rounded border border-line bg-surface-2 px-3 text-sm tabular-nums text-fg" />
                    </Field>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Stock"><Select name="restock" defaultValue="yes"><option value="yes">Put back on the shelf</option><option value="no">Write off (opened or damaged)</option></Select></Field>
                  <Field label="Refund by"><Select name="refundMethod" defaultValue="cash">{["cash", "mobile_money", "card", "bank"].map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}{s.customerId && <option value="credit">Customer account</option>}</Select></Field>
                </div>
                <Field label="Reason"><Textarea name="reason" rows={2} required /></Field>
                <Submit variant="secondary">Record return</Submit>
              </ActionForm>
            </Panel>
          )}
        </div>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Summary" glow>
            <Dl cols={1} items={[
              ["Subtotal", money(s.subtotalMinor, cur)], ["Discount", money(s.discountMinor, cur)], ["Tax", money(s.taxMinor, cur)],
              ["Total", <strong key="t" className="text-lg tabular-nums">{money(s.totalMinor, cur)}</strong>],
              ...(s.payerPortionMinor ? [[`${d.payer?.name ?? "Payer"} share`, money(s.payerPortionMinor, cur)] as [string, React.ReactNode]] : []),
              ["Paid by customer", money(s.paidMinor, cur)], ["On account", money(s.creditMinor, cur)], ["Change given", money(s.changeMinor, cur)],
              ...(s.loyaltyEarned || s.loyaltyRedeemed ? [["Points earned / used", `${s.loyaltyEarned} / ${s.loyaltyRedeemed}`] as [string, React.ReactNode]] : []),
            ]} />
          </Panel>
          <Panel title="People">
            <Dl cols={1} items={[
              ["Customer", d.customer ? <A key="c" href={`/customers/${d.customer.id}`}>{d.customer.name}</A> : "Walk-in"],
              ["Cashier", name(s.cashierId)], ["Pharmacist", s.pharmacistId ? name(s.pharmacistId) : "—"],
              ...(d.rx ? [["Prescription", <A key="r" href={`/prescriptions/${d.rx.id}`}>{d.rx.rxNo}</A>] as [string, React.ReactNode]] : []),
              ...(s.memberNo ? [["Member no.", s.memberNo] as [string, React.ReactNode]] : []),
              ...(s.status === "voided" ? [["Voided by", `${name(s.voidedBy)}: ${s.voidReason ?? ""}`] as [string, React.ReactNode]] : []),
            ]} />
          </Panel>
          {canVoid && (
            <Panel title="Void sale" eyebrow="Today only">
              <ActionForm action={voidSaleAction}>
                <input type="hidden" name="saleId" value={s.id} />
                <Field label="Reason"><Textarea name="reason" rows={2} required placeholder="e.g. Rung up twice" /></Field>
                <Submit variant="danger">Void sale</Submit>
              </ActionForm>
            </Panel>
          )}
          {d.log.length > 0 && (
            <Panel title="History">
              <Timeline items={d.log.map(({ a, by }) => ({ id: a.id, title: `${a.action} by ${by ?? "system"}`, meta: dateTime(a.at, tz), tone: a.action === "void" ? "red" as const : a.action === "return" ? "yellow" as const : "purple" as const }))} />
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
