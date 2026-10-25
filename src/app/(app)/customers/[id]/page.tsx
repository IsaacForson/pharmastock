import { desc, eq } from "drizzle-orm";
import { FileText, MessageCircle, Pencil, ScanLine, Wallet } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { Avatar, Badge, Callout, Dl, EmptyState, Field, Input, LinkButton, Panel, Select, Table, Td } from "@/components/ui";
import { customerLedger, customers, loyaltyEntries, payers, prescriptions, sales } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { age, dateOnly, dateTime, localDay, money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { newClientId } from "@/lib/pos-catalog";
import { STATUS_TONE } from "../../sales/status";
import { balanceReminderAction, repaymentAction } from "../actions";

export const metadata = { title: "Customer" };

const LEDGER_LABEL: Record<string, string> = { credit_sale: "Credit sale", repayment: "Payment", write_off: "Written off", return: "Return / void" };

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx("customers.read");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const role = ctx.user.role, tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const showRx = hasFeature(ctx.tenant, "prescriptions") && can(role, "prescriptions.read");
  const d = await tx(ctx, async (t) => {
    const [c] = await t.select().from(customers).where(eq(customers.id, id));
    if (!c || c.deletedAt) return null;
    const [payer] = c.payerId ? await t.select({ name: payers.name }).from(payers).where(eq(payers.id, c.payerId)) : [];
    const history = await t.select().from(sales).where(eq(sales.customerId, id)).orderBy(desc(sales.soldAt)).limit(50);
    const ledger = await t.select().from(customerLedger).where(eq(customerLedger.customerId, id)).orderBy(desc(customerLedger.createdAt)).limit(50);
    const points = await t.select().from(loyaltyEntries).where(eq(loyaltyEntries.customerId, id)).orderBy(desc(loyaltyEntries.createdAt)).limit(30);
    const rxs = showRx ? await t.select().from(prescriptions).where(eq(prescriptions.customerId, id)).orderBy(desc(prescriptions.issuedOn)).limit(30) : [];
    await audit(t, ctx, "view", "customer", id, { customerId: id, details: showRx && rxs.length ? { prescriptions: rxs.length } : undefined });
    return { c, payer: payer?.name ?? null, history, ledger, points, rxs };
  });
  if (!d) notFound();
  const { c } = d;
  const today = localDay(tz);
  const live = d.history.filter((s) => s.status !== "voided");
  const spent = live.reduce((s, x) => s + x.totalMinor, 0);
  const refills = d.rxs.filter((r) => r.status === "active" && r.nextRefillDue);
  const write = ctx.access === "full";

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Panel glow>
          <div className="flex flex-col items-center text-center">
            <Avatar name={c.name} size="lg" />
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">{c.name}</h1>
            <div className="font-mono text-xs text-muted">{c.customerNo}</div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {c.balanceMinor > 0 && <Badge tone="yellow">Owes {money(c.balanceMinor, cur)}</Badge>}
              {c.loyaltyPoints > 0 && <Badge tone="purple">{c.loyaltyPoints} points</Badge>}
              {c.optedOutAt ? <Badge tone="red">opted out</Badge> : c.messagingConsent ? <Badge tone="green">messages ok</Badge> : <Badge>no consent</Badge>}
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {can(role, "pos.sell") && write && <LinkButton href="/pos" size="sm"><ScanLine className="h-4 w-4" aria-hidden /> Sell</LinkButton>}
              {can(role, "customers.write") && write && <LinkButton href={`/customers/${c.id}/edit`} size="sm" variant="secondary"><Pencil className="h-4 w-4" aria-hidden /> Edit</LinkButton>}
              {showRx && can(role, "prescriptions.write") && write && <LinkButton href={`/prescriptions/new?customer=${c.id}`} size="sm" variant="secondary"><FileText className="h-4 w-4" aria-hidden /> Prescription</LinkButton>}
            </div>
          </div>
        </Panel>
        {c.allergies && <Callout tone="red"><strong>Allergies:</strong> {c.allergies}</Callout>}
        <Panel title="Details">
          <Dl cols={1} items={[
            ["Phone", c.phone ?? "—"], ["Email", c.email ?? "—"], ["Age", c.dob ? `${age(c.dob)} (${dateOnly(c.dob, tz)})` : "—"], ["Address", c.address ?? "—"],
            ["Insurer", d.payer ? `${d.payer}${c.memberNo ? ` · ${c.memberNo}` : ""}` : "—"],
            ["Credit limit", money(c.creditLimitMinor, cur)],
            ["Consent", c.messagingConsent ? `${c.consentMethod ?? "recorded"} · ${dateTime(c.consentRecordedAt, tz)}` : "Not given"],
            ...(c.optedOutAt ? [["Opted out", dateTime(c.optedOutAt, tz)] as [string, React.ReactNode]] : []),
            ...(c.notes ? [["Notes", <span key="n" className="whitespace-pre-line">{c.notes}</span>] as [string, React.ReactNode]] : []),
          ]} />
        </Panel>
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel><div className="text-xs text-muted">Visits</div><div className="text-2xl font-semibold tabular-nums text-fg">{live.length}</div></Panel>
          <Panel><div className="text-xs text-muted">Spent</div><div className="text-2xl font-semibold tabular-nums text-fg">{money(spent, cur)}</div></Panel>
          <Panel><div className="text-xs text-muted">Balance</div><div className={c.balanceMinor > 0 ? "text-2xl font-semibold tabular-nums text-warn" : "text-2xl font-semibold tabular-nums text-fg"}>{money(c.balanceMinor, cur)}</div></Panel>
        </div>

        {refills.length > 0 && (
          <Panel title="Refills due" icon={<FileText />}>
            <ul className="divide-y divide-line">
              {refills.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/prescriptions/${r.id}`} className="font-mono text-xs text-accent hover:underline">{r.rxNo}</Link>
                  <span className="text-muted">{r.refillsUsed} of {r.refillsAllowed + 1} fills used</span>
                  <Badge tone={r.nextRefillDue! <= today ? "red" : "blue"}>due {r.nextRefillDue}</Badge>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Account" icon={<Wallet />} actions={c.balanceMinor > 0 && can(role, "customers.write") && write && (
          <ActionForm action={balanceReminderAction}><input type="hidden" name="customerId" value={c.id} /><Submit variant="ghost" size="sm"><MessageCircle className="h-4 w-4" aria-hidden /> Send reminder</Submit></ActionForm>
        )}>
          {c.balanceMinor > 0 && can(role, "pos.sell") && write && (
            <ActionForm action={repaymentAction} resetOnSuccess className="mb-4 rounded-md border border-line p-4">
              <input type="hidden" name="customerId" value={c.id} />
              <input type="hidden" name="clientId" value={newClientId()} />
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <Field label="Payment"><Input name="amount" inputMode="decimal" required placeholder={(c.balanceMinor / 100).toFixed(2)} /></Field>
                <Field label="Method"><Select name="method"><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="bank">Bank transfer</option></Select></Field>
                <Field label="Reference"><Input name="reference" /></Field>
                <Submit>Record payment</Submit>
              </div>
            </ActionForm>
          )}
          {d.ledger.length ? (
            <ul className="divide-y divide-line text-sm">
              {d.ledger.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{LEDGER_LABEL[l.kind] ?? l.kind}{l.note ? <span className="text-muted"> · {l.note}</span> : null}</span>
                  <span className="text-xs text-muted">{dateTime(l.createdAt, tz)}</span>
                  <span className={l.amountMinor > 0 ? "tabular-nums text-warn" : "tabular-nums text-ok"}>{l.amountMinor > 0 ? "+" : ""}{money(l.amountMinor, cur)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No account activity.</p>}
        </Panel>

        <Panel title="Purchases" bodyClassName="p-0">
          <Table head={["Sale", "Date", "Total", "Status"]} empty={<EmptyState title="No purchases yet" compact />}>
            {d.history.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2">
                <Td><Link href={`/sales/${s.id}`} className="font-mono text-xs font-semibold text-accent hover:underline">{s.saleNo}</Link></Td>
                <Td className="text-muted">{dateTime(s.soldAt, tz)}</Td>
                <Td className="tabular-nums">{money(s.totalMinor, cur)}</Td>
                <Td><Badge tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ")}</Badge></Td>
              </tr>
            ))}
          </Table>
        </Panel>

        {showRx && (
          <Panel title="Prescriptions" bodyClassName="p-0">
            <Table head={["Rx", "Issued", "Prescriber", "Fills", "Status"]} empty={<EmptyState title="No prescriptions" compact />}>
              {d.rxs.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2">
                  <Td><Link href={`/prescriptions/${r.id}`} className="font-mono text-xs font-semibold text-accent hover:underline">{r.rxNo}</Link></Td>
                  <Td className="text-muted">{r.issuedOn}</Td><Td>{r.prescriberName}</Td><Td className="tabular-nums">{r.refillsUsed} / {r.refillsAllowed + 1}</Td>
                  <Td><Badge tone={r.status === "active" ? "green" : "gray"}>{r.status}</Badge></Td>
                </tr>
              ))}
            </Table>
          </Panel>
        )}

        {d.points.length > 0 && (
          <Panel title="Loyalty points">
            <ul className="divide-y divide-line text-sm">
              {d.points.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2"><span className="capitalize">{p.reason}</span><span className="text-xs text-muted">{dateTime(p.createdAt, tz)}</span><span className={p.points > 0 ? "tabular-nums text-ok" : "tabular-nums text-muted"}>{p.points > 0 ? "+" : ""}{p.points}</span></li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
