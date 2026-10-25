import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ArrowLeft, Flame, RotateCcw, Scale, TriangleAlert } from "lucide-react";
import { ActionForm, PrintButton, Submit } from "@/components/form";
import { Badge, Button, Callout, Field, Input, LinkButton, Panel, Select, Td, Textarea } from "@/components/ui";
import { branches, controlledRegister, products, stockBatches, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { dateTime, dayRange, localDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { correctionAction, destroyAction, patientReturnAction } from "../actions";

export const metadata = { title: "Controlled register" };

const KIND: Record<string, string> = {
  received: "Received", supplied: "Supplied", returned_by_patient: "Returned by customer", returned_to_supplier: "Returned to supplier",
  destroyed: "Destroyed", adjusted: "Correction", transfer_in: "Transfer in", transfer_out: "Transfer out",
};
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function RegisterProductPage({ params, searchParams }: PageProps<"/register/[productId]">) {
  const ctx = await requireCtx("controlled.register");
  if (!hasFeature(ctx.tenant, "controlled")) notFound();
  const { productId } = await params;
  const sp = await searchParams;
  const tz = ctx.tenant.timezone;
  const from = isDay(sp.from) ? sp.from : null, to = isDay(sp.to) ? sp.to : null;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) notFound();

  const data = await tx(ctx, async (t) => {
    const [product] = await t.select().from(products).where(and(eq(products.id, productId), eq(products.schedule, "controlled")));
    if (!product) return null;
    const [branch] = await t.select().from(branches).where(eq(branches.id, ctx.branchId));
    const scope = and(eq(controlledRegister.productId, productId), eq(controlledRegister.branchId, ctx.branchId));
    const entries = await t.select({ e: controlledRegister, by: users.name, batchNo: stockBatches.batchNo }).from(controlledRegister)
      .leftJoin(users, eq(users.id, controlledRegister.enteredBy)).leftJoin(stockBatches, eq(stockBatches.id, controlledRegister.batchId))
      .where(and(scope, from ? gte(controlledRegister.createdAt, dayRange(from, tz).start) : undefined, to ? lt(controlledRegister.createdAt, dayRange(to, tz).end) : undefined))
      .orderBy(asc(controlledRegister.entryNo));
    const [prior] = from ? await t.select({ balance: controlledRegister.balance }).from(controlledRegister)
      .where(and(scope, lt(controlledRegister.createdAt, dayRange(from, tz).start))).orderBy(desc(controlledRegister.entryNo)).limit(1) : [];
    const [last] = await t.select({ balance: controlledRegister.balance }).from(controlledRegister).where(scope).orderBy(desc(controlledRegister.entryNo)).limit(1);
    const batches = await t.select().from(stockBatches).where(and(eq(stockBatches.productId, productId), eq(stockBatches.branchId, ctx.branchId)))
      .orderBy(sql`${stockBatches.expiry} asc nulls last`);
    return { product, branch, entries, brought: prior?.balance ?? null, balance: last?.balance ?? 0, batches };
  });
  if (!data) notFound();
  const { product, branch, entries, batches } = data;
  const onHand = batches.reduce((s, b) => s + b.qtyOnHand, 0);
  const rules = rulesFor(ctx.tenant.country);
  const today = localDay(tz);
  const stocked = batches.filter((b) => b.qtyOnHand > 0);
  const batchLabel = (b: (typeof batches)[number]) => `${b.batchNo || "No batch no."}${b.expiry ? ` · exp ${b.expiry}` : ""} · ${b.qtyOnHand} ${product.baseUnit}`;
  const summary = "flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-fg transition hover:bg-surface-2 [&::-webkit-details-marker]:hidden";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <LinkButton href="/register" variant="ghost"><ArrowLeft className="h-4 w-4" aria-hidden /> All controlled products</LinkButton>
        <PrintButton />
      </div>

      {data.balance !== onHand && (
        <div className="print:hidden">
          <Callout tone="red" icon={<TriangleAlert />}>
            Register balance is {data.balance} {product.baseUnit} but stock shows {onHand}. Count the stock and record a correction below.
          </Callout>
        </div>
      )}

      <form className="glass flex flex-wrap items-end gap-3 p-4 print:hidden">
        <Field label="From"><Input type="date" name="from" defaultValue={from ?? ""} max={today} /></Field>
        <Field label="To"><Input type="date" name="to" defaultValue={to ?? ""} max={today} /></Field>
        <Button variant="secondary">Show</Button>
        {(from || to) && <LinkButton href={`/register/${productId}`} variant="ghost">Clear dates</LinkButton>}
      </form>

      <article className="glass p-6 print:border-0 print:p-0 print:shadow-none">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <div className="text-lg font-semibold text-fg">{ctx.tenant.name}</div>
            <div className="text-xs text-muted">{branch?.name}{branch?.address ? ` · ${branch.address}` : ""}</div>
            {(branch?.licenceNo || ctx.tenant.licenceNo) && <div className="text-xs text-muted">Premises licence: {branch?.licenceNo || ctx.tenant.licenceNo}</div>}
            {ctx.tenant.superintendent && <div className="text-xs text-muted">Superintendent pharmacist: {ctx.tenant.superintendent}{ctx.tenant.superintendentRegNo ? ` (Reg. ${ctx.tenant.superintendentRegNo})` : ""}</div>}
          </div>
          <div className="text-right">
            <h1 className="text-base font-semibold text-fg">{rules.registerTitle}</h1>
            <div className="text-sm text-fg">{product.name} {product.strength} {product.form}</div>
            <div className="text-xs text-muted">Unit: {product.baseUnit} · {from || to ? `${from ?? "start"} to ${to ?? "today"}` : "All entries"}</div>
          </div>
        </header>
        <div className="-mx-6 overflow-x-auto print:mx-0">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.12em] text-subtle">
                {["Date", "Entry", "Received from / supplied to", "Address", "Prescriber (reg. no.)", "Rx no.", "In", "Out", "Balance", "Entered by", "Witness", "Details"].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 pb-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.brought !== null && (
                <tr><Td className="px-3 py-2 text-muted" colSpan={8}>Balance brought forward</Td><Td className="px-3 py-2 font-semibold tabular-nums">{data.brought}</Td><Td colSpan={3} className="px-3 py-2" /></tr>
              )}
              {entries.map(({ e, by, batchNo }) => (
                <tr key={e.id}>
                  <Td className="px-3 py-2 tabular-nums">{dateTime(e.createdAt, tz)}</Td>
                  <Td className="px-3 py-2 font-mono tabular-nums">{e.entryNo}</Td>
                  <Td className="px-3 py-2">{e.partyName ?? <span className="text-subtle">—</span>}</Td>
                  <Td className="max-w-48 truncate px-3 py-2">{e.partyAddress ?? ""}</Td>
                  <Td className="px-3 py-2">{e.prescriberName ? `${e.prescriberName}${e.prescriberRegNo ? ` (${e.prescriberRegNo})` : ""}` : ""}</Td>
                  <Td className="px-3 py-2 font-mono">{e.rxNo ?? ""}</Td>
                  <Td className="px-3 py-2 tabular-nums text-ok">{e.qtyIn || ""}</Td>
                  <Td className="px-3 py-2 tabular-nums text-bad">{e.qtyOut || ""}</Td>
                  <Td className="px-3 py-2 font-semibold tabular-nums">{e.balance}</Td>
                  <Td className="px-3 py-2">{by ?? ""}</Td>
                  <Td className="px-3 py-2">{e.witnessName ?? ""}</Td>
                  <Td className="whitespace-normal px-3 py-2 text-muted">
                    {KIND[e.kind] ?? e.kind}{e.docRef ? ` · ${e.docRef}` : ""}{batchNo ? ` · batch ${batchNo}` : ""}{e.note ? ` · ${e.note}` : ""}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="px-6 py-8 text-center text-sm text-muted">No register entries for these dates.</p>}
        </div>
        <footer className="mt-6 hidden justify-between gap-8 text-xs text-muted print:flex">
          <span>Printed {dateTime(new Date(), tz)}</span>
          <span>Pharmacist signature: ______________________</span>
        </footer>
      </article>

      <Panel title="Record an entry" eyebrow="Manual entries" icon={<Scale />} className="print:hidden"
        actions={<Badge tone={data.balance === onHand ? "green" : "red"}>Stock {onHand} {product.baseUnit}</Badge>}>
        <p className="mb-3 text-sm text-muted">Sales, receipts and transfers are entered automatically. Use these only for destruction, returns from customers and corrections. Entries can&apos;t be edited; a mistake is fixed with a new correction.</p>
        <div className="space-y-1">
          {can(ctx.user.role, "controlled.destroy") && (
            <details className="rounded-xl">
              <summary className={summary}><Flame className="h-4 w-4 text-bad" aria-hidden /> Destroy stock (witness needed)</summary>
              <ActionForm action={destroyAction} resetOnSuccess className="grid gap-4 px-3 pb-3 pt-2 sm:grid-cols-2">
                <Field label="Batch"><Select name="batchId" required>{stocked.map((b) => <option key={b.id} value={b.id}>{batchLabel(b)}</option>)}</Select></Field>
                <Field label={`Quantity (${product.baseUnit})`}><Input name="qty" type="number" min={1} required /></Field>
                <Field label="Reason"><Select name="kind"><option value="expire">Expired</option><option value="damage">Damaged / unusable</option></Select></Field>
                <Field label="Witness name" hint="The person who watched the destruction"><Input name="witnessName" required /></Field>
                <Field label="Notes" className="sm:col-span-2"><Textarea name="note" placeholder="How and where it was destroyed" /></Field>
                <div className="flex justify-end sm:col-span-2"><Submit variant="danger">Record destruction</Submit></div>
              </ActionForm>
            </details>
          )}
          <details className="rounded-xl">
            <summary className={summary}><RotateCcw className="h-4 w-4 text-accent" aria-hidden /> Customer returned stock</summary>
            <ActionForm action={patientReturnAction} resetOnSuccess className="grid gap-4 px-3 pb-3 pt-2 sm:grid-cols-2">
              <Field label="Into batch"><Select name="batchId" required>{batches.map((b) => <option key={b.id} value={b.id}>{batchLabel(b)}</option>)}</Select></Field>
              <Field label={`Quantity (${product.baseUnit})`}><Input name="qty" type="number" min={1} required /></Field>
              <Field label="Returned by"><Input name="partyName" required /></Field>
              <Field label="Rx no."><Input name="rxNo" /></Field>
              <Field label="Address" className="sm:col-span-2"><Input name="partyAddress" /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="note" /></Field>
              <div className="flex justify-end sm:col-span-2"><Submit variant="secondary">Record return</Submit></div>
            </ActionForm>
          </details>
          <details className="rounded-xl">
            <summary className={summary}><Scale className="h-4 w-4 text-warn" aria-hidden /> Correct the balance</summary>
            <ActionForm action={correctionAction} resetOnSuccess className="grid gap-4 px-3 pb-3 pt-2 sm:grid-cols-2">
              <Field label="Batch"><Select name="batchId" required>{batches.map((b) => <option key={b.id} value={b.id}>{batchLabel(b)}</option>)}</Select></Field>
              <Field label={`Change (${product.baseUnit})`} hint="Positive to add, negative to remove, e.g. -2"><Input name="delta" type="number" required /></Field>
              <Field label="Reason" className="sm:col-span-2"><Textarea name="reason" required placeholder="e.g. Counted 18, register showed 20" /></Field>
              <div className="flex justify-end sm:col-span-2"><Submit variant="secondary">Record correction</Submit></div>
            </ActionForm>
          </details>
        </div>
      </Panel>
    </div>
  );
}
