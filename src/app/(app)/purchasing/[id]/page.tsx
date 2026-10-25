import { desc, eq } from "drizzle-orm";
import { CheckCircle2, Mail, MessageCircle, PackagePlus, Pencil, Printer, ShoppingCart, XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/form";
import { A, Badge, Callout, cx, Dl, LinkButton, PageHeader, Panel, Progress, Table, Td } from "@/components/ui";
import { goodsReceipts, productUnits, products, purchaseOrderLines, purchaseOrders, suppliers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, dateTime, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { acceptSupplierChangesAction, cancelPoAction, sendPoAction } from "../actions";
import { PO_STATUS } from "../status";

export const metadata = { title: "Purchase order" };

export default async function PoPage({ params }: PageProps<"/purchasing/[id]">) {
  const ctx = await requireCtx("purchasing.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await tx(ctx, async (t) => {
    const [row] = await t.select({ po: purchaseOrders, s: suppliers, by: users.name }).from(purchaseOrders).innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .leftJoin(users, eq(users.id, purchaseOrders.createdBy)).where(eq(purchaseOrders.id, id));
    if (!row) return null;
    const lines = await t.select({ l: purchaseOrderLines, name: products.name, strength: products.strength, unit: productUnits.name, factor: productUnits.factor })
      .from(purchaseOrderLines).innerJoin(products, eq(products.id, purchaseOrderLines.productId)).innerJoin(productUnits, eq(productUnits.id, purchaseOrderLines.unitId))
      .where(eq(purchaseOrderLines.poId, id)).orderBy(products.name);
    const grns = await t.select().from(goodsReceipts).where(eq(goodsReceipts.poId, id)).orderBy(desc(goodsReceipts.receivedAt));
    return { ...row, lines, grns };
  });
  if (!d) notFound();
  const { po, s } = d;
  const cur = ctx.tenant.currency, tz = ctx.tenant.timezone;
  const st = PO_STATUS[po.status];
  const changed = (x: (typeof d.lines)[number]["l"]) => x.supplierQty !== null && (x.supplierQty !== x.qty || (x.supplierCostMinor ?? x.unitCostMinor) !== x.unitCostMinor);
  const diffs = d.lines.filter((x) => changed(x.l)).length;
  const ordered = d.lines.reduce((n, x) => n + x.l.qty * x.factor, 0);
  const received = d.lines.reduce((n, x) => n + Math.min(x.l.receivedBaseQty, x.l.qty * x.factor), 0);
  const editable = po.status === "draft" || po.status === "sent";
  const sendable = (["draft", "sent", "confirmed"] as string[]).includes(po.status) && hasFeature(ctx.tenant, "supplier_ordering");
  const receivable = (["draft", "sent", "confirmed", "partially_received"] as string[]).includes(po.status) && can(ctx.user.role, "stock.receive");

  return (
    <>
      <PageHeader eyebrow={<span className="font-mono">{po.poNo}</span>} title={s.name} icon={<ShoppingCart />}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={st.tone}>{st.label}</Badge>{po.sentAt && <span>Sent {dateTime(po.sentAt, tz)} by {po.sentVia}</span>}</span>}
        actions={<>
          <LinkButton href={`/purchasing/${id}/print`} variant="secondary"><Printer className="h-4 w-4" aria-hidden />Print</LinkButton>
          {editable && <LinkButton href={`/purchasing/${id}/edit`} variant="secondary"><Pencil className="h-4 w-4" aria-hidden />Edit</LinkButton>}
          {receivable && <LinkButton href={`/receiving/new?po=${id}`}><PackagePlus className="h-4 w-4" aria-hidden />{po.status === "partially_received" ? "Receive the rest" : "Receive delivery"}</LinkButton>}
        </>} />

      {po.status === "confirmed" && diffs > 0 && (
        <div className="mb-6">
          <Callout tone="yellow" icon={<CheckCircle2 />} actions={<ActionButton action={acceptSupplierChangesAction} fields={{ id }} variant="primary">Accept supplier changes</ActionButton>}>
            {s.name} confirmed this order with changes on {diffs} line{diffs === 1 ? "" : "s"} (highlighted below).{po.supplierNote && <> They wrote: “{po.supplierNote}”</>}
          </Callout>
        </div>
      )}
      {po.status === "confirmed" && diffs === 0 && (
        <div className="mb-6"><Callout tone="green" icon={<CheckCircle2 />}>{s.name} confirmed this order as sent{po.confirmedAt ? ` on ${dateTime(po.confirmedAt, tz)}` : ""}.{po.supplierNote && <> Note: “{po.supplierNote}”</>}</Callout></div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title="Lines" eyebrow={`${d.lines.length} products`}>
          <Table head={["Product", "Ordered", "Supplier confirmed", "Received", "Cost per pack", "Line total"]}>
            {d.lines.map(({ l, name, strength, unit, factor }) => {
              const diff = changed(l);
              return (
                <tr key={l.id} className={cx(diff && "bg-warn/10")}>
                  <Td className="font-medium">{name}{strength && <span className="text-muted"> {strength}</span>}</Td>
                  <Td className="tabular-nums">{l.qty} × {unit}</Td>
                  <Td className={cx("tabular-nums", diff ? "font-medium text-warn" : "text-muted")}>
                    {l.supplierQty === null ? "—" : <>{l.supplierQty}{l.supplierCostMinor !== null && l.supplierCostMinor !== l.unitCostMinor && <> @ {money(l.supplierCostMinor, cur)}</>}{diff && <span className="sr-only"> (changed)</span>}</>}
                  </Td>
                  <Td className="tabular-nums text-muted">{l.receivedBaseQty ? `${+(l.receivedBaseQty / factor).toFixed(2)} of ${l.qty}` : "—"}</Td>
                  <Td className="tabular-nums">{money(l.unitCostMinor, cur)}</Td>
                  <Td className="text-right tabular-nums">{money(l.qty * l.unitCostMinor, cur)}</Td>
                </tr>
              );
            })}
          </Table>
          <div className="mt-4 flex justify-end border-t border-line pt-4 text-lg font-semibold tabular-nums text-fg">{money(po.totalMinor, cur)}</div>
        </Panel>

        <div className="space-y-6">
          <Panel title="Details">
            <Dl cols={1} items={[
              ["Supplier", <A key="s" href={`/suppliers/${s.id}`}>{s.name}</A>],
              ["Contact", [s.contactName, s.phone, s.email].filter(Boolean).join(" · ")],
              ["Expected", po.expectedAt ? dateOnly(po.expectedAt, "UTC") : null],
              ["Created", `${dateTime(po.createdAt, tz)}${d.by ? ` by ${d.by}` : ""}`],
              ["Note", po.notes],
            ]} />
            {ordered > 0 && po.status !== "draft" && (
              <div className="mt-5 space-y-1.5">
                <div className="flex justify-between text-xs text-muted"><span>Received</span><span className="tabular-nums">{Math.round((received / ordered) * 100)}%</span></div>
                <Progress value={(received / ordered) * 100} tone={received >= ordered ? "green" : "purple"} />
              </div>
            )}
          </Panel>

          {(sendable || po.status !== "received") && po.status !== "cancelled" && (
            <Panel title="Send to supplier" eyebrow="WhatsApp or email" bodyClassName="space-y-3 p-5">
              {sendable ? (
                <>
                  <p className="text-sm text-muted">The supplier gets a link to view the order on your letterhead and confirm quantities and prices.</p>
                  <div className="flex flex-wrap gap-2">
                    {s.phone && <ActionButton action={sendPoAction} fields={{ id, via: "whatsapp" }} variant={po.sentAt ? "secondary" : "primary"}><MessageCircle className="h-3.5 w-3.5" aria-hidden />{po.sentAt ? "Send again" : "Send"} on WhatsApp</ActionButton>}
                    {s.email && <ActionButton action={sendPoAction} fields={{ id, via: "email" }}><Mail className="h-3.5 w-3.5" aria-hidden />Email</ActionButton>}
                  </div>
                  {!s.phone && !s.email && <p className="text-sm text-warn">Add a WhatsApp number or email on the <A href={`/suppliers/${s.id}/edit`}>supplier</A> to send orders.</p>}
                </>
              ) : !hasFeature(ctx.tenant, "supplier_ordering") && po.status !== "received" ? (
                <p className="text-sm text-muted">Sending orders on WhatsApp is on the Pro plan. Print the order and hand it over instead.</p>
              ) : null}
              {po.status !== "received" && (
                <div className="border-t border-line pt-3">
                  <ActionButton action={cancelPoAction} fields={{ id }} variant="danger" confirm={`Cancel ${po.poNo}? This can't be undone.`}><XCircle className="h-3.5 w-3.5" aria-hidden />Cancel order</ActionButton>
                </div>
              )}
            </Panel>
          )}

          {d.grns.length > 0 && (
            <Panel title="Deliveries" eyebrow="Goods received">
              <ul className="space-y-2 text-sm">
                {d.grns.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3">
                    <A href={`/receiving/${g.id}`} className="font-mono text-xs">{g.grnNo}</A>
                    <span className="text-muted">{dateOnly(g.receivedAt, tz)}</span>
                    <span className="tabular-nums">{money(g.totalMinor, cur)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
