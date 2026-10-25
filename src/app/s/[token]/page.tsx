import { eq } from "drizzle-orm";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { LogoMark } from "@/app/(app)/nav";
import { Letterhead, Sheet } from "@/app/(app)/purchasing/letterhead";
import { PoDocument } from "@/app/(app)/purchasing/po-document";
import { ActionForm, PrintButton, Submit } from "@/components/form";
import { Callout, Field, Input, Panel, Table, Td, Textarea } from "@/components/ui";
import { withTenant } from "@/db";
import { branches, productUnits, products, purchaseOrderLines } from "@/db/schema";
import { dateOnly, dateTime, money } from "@/lib/format";
import { resolveSupplierLink } from "../session";
import { confirmPoAction } from "./actions";

function Gone({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[70vh] items-center">
      <div className="glass mx-auto w-full max-w-md p-8 text-center animate-rise">
        <LogoMark className="mx-auto h-12 w-12" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-fg">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  );
}

export default async function SupplierPortalPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const s = await resolveSupplierLink(token);
  if (s === "blocked") return <Gone title="Too many attempts">Please wait a few minutes and open the link from your message again.</Gone>;
  if (!s) return <Gone title="This link has expired">Order links work for 30 days. Ask the pharmacy to send the order again.</Gone>;
  const { tenant, po, supplier } = s;
  const d = await withTenant(tenant.id, async (t) => ({
    branch: (await t.select().from(branches).where(eq(branches.id, po.branchId)))[0] ?? null,
    lines: await t.select({ l: purchaseOrderLines, name: products.name, strength: products.strength, unit: productUnits.name })
      .from(purchaseOrderLines).innerJoin(products, eq(products.id, purchaseOrderLines.productId)).innerJoin(productUnits, eq(productUnits.id, purchaseOrderLines.unitId))
      .where(eq(purchaseOrderLines.poId, po.id)).orderBy(products.name),
  }));
  const fmt = (m: number) => money(m, tenant.currency);
  const open = po.status === "sent" || po.status === "confirmed";

  return (
    <div className="space-y-6">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <Sheet>
        <Letterhead tenant={tenant} branch={d.branch} title="Purchase order" number={po.poNo}>
          <div>Date {dateOnly(po.createdAt, tenant.timezone)}</div>
          {po.expectedAt && <div>Deliver by {dateOnly(po.expectedAt, "UTC")}</div>}
        </Letterhead>
        <PoDocument supplier={supplier} lines={d.lines.map(({ l, ...x }) => ({ ...x, qty: l.qty, unitCostMinor: l.unitCostMinor }))} totalMinor={po.totalMinor} notes={po.notes} fmt={fmt} />
      </Sheet>

      <div className="print:hidden">
        {po.status === "confirmed" && po.confirmedAt && (
          <div className="mb-4"><Callout tone="green" icon={<CheckCircle2 />}>You confirmed this order on {dateTime(po.confirmedAt, tenant.timezone)}. You can update your answer below until the pharmacy receives it.</Callout></div>
        )}
        {open ? (
          <Panel title="Confirm this order" eyebrow={`For ${tenant.name}`}>
            <p className="mb-4 text-sm text-muted">Check what you can supply and at what price. Change any quantity or price that differs, then confirm.</p>
            <ActionForm action={confirmPoAction}>
              <input type="hidden" name="token" value={token} />
              <Table head={["Product", "Ordered", "You can supply", "Your price per pack"]}>
                {d.lines.map(({ l, name, strength, unit }) => (
                  <tr key={l.id}>
                    <Td className="font-medium">{name} {strength}<div className="text-xs text-muted">{unit}</div></Td>
                    <Td className="tabular-nums">{l.qty} @ {fmt(l.unitCostMinor)}</Td>
                    <Td><Input name={`qty:${l.id}`} type="number" min={0} required defaultValue={l.supplierQty ?? l.qty} aria-label={`Quantity of ${name} you can supply`} className="h-9 w-24 tabular-nums" /></Td>
                    <Td><Input name={`cost:${l.id}`} inputMode="decimal" required defaultValue={((l.supplierCostMinor ?? l.unitCostMinor) / 100).toFixed(2)} aria-label={`Your price for ${name}`} className="h-9 w-28 tabular-nums" /></Td>
                  </tr>
                ))}
              </Table>
              <Field label="Note to the pharmacy" className="pt-2"><Textarea name="note" defaultValue={po.supplierNote ?? ""} placeholder="Delivery date, substitutes, out-of-stock items…" /></Field>
              <div className="flex justify-end"><Submit size="lg">Confirm order</Submit></div>
            </ActionForm>
          </Panel>
        ) : (
          <Callout tone="blue" icon={<ShieldAlert />}>
            {po.status === "cancelled" ? "The pharmacy cancelled this order." : po.status === "draft" ? "This order is being edited by the pharmacy." : "This order has been received. Thank you."}
          </Callout>
        )}
        <p className="mt-6 text-center text-xs text-subtle">Sent with PharmaStock on behalf of {tenant.name}. Only you have this link; please don&apos;t forward it.</p>
      </div>
    </div>
  );
}
