import { ArrowLeft, BookOpenCheck, Download, FileSpreadsheet, Scale, Webhook } from "lucide-react";
import { A, Badge, Callout, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { buildJournal } from "@/lib/analytics";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly, money } from "@/lib/format";
import { resolveRange } from "../range";
import { reportScope } from "../scope";
import { BranchPicker, RangePicker, rangeQuery } from "../ui";
import { DOCS, journalInput } from "./data";

export const metadata = { title: "Accounting export" };

const WEBHOOKS: [string, string][] = [
  ["sale.completed", "{ id, saleNo, branchId, totalMinor, taxMinor, soldAt, customerId }"],
  ["sale.voided", "{ id, saleNo, reason }"],
  ["sale.returned", "{ id, saleNo, returnNo, refundMinor }"],
  ["payment.received", "{ id, customerId, amountMinor, method, receiptNo }"],
  ["alert.raised", "{ id, kind, branchId, title, valueMinor, productId, batchId, dueOn }"],
];

export default async function AccountingPage({ searchParams }: PageProps<"/reports/accounting">) {
  const ctx = await requireCtx("export");
  const sp = await searchParams;
  const range = resolveRange(sp, ctx.tenant.timezone, new Date(), "lastMonth");
  const scope = reportScope(ctx, sp.branch);
  const journal = await tx(ctx, async (t) => buildJournal(await journalInput(t, { range, branches: scope.ids, all: scope.all || ctx.branches.length === 1, tz: ctx.tenant.timezone })));
  const cur = ctx.tenant.currency;
  const dr = journal.reduce((s, r) => s + r.debit, 0), cr = journal.reduce((s, r) => s + r.credit, 0);
  const keep = scope.all ? { branch: "all" } : { branch: scope.ids[0] };
  const qs = (doc: string) => `/api/reports/accounting?${new URLSearchParams({ ...keep, ...Object.fromEntries(new URLSearchParams(rangeQuery(range))), doc })}`;
  return (
    <>
      <PageHeader icon={<BookOpenCheck />} eyebrow={<A href="/reports">Reports · Finance</A>} title="Accounting export"
        subtitle={<>Journal and document files for your accountant or accounting software. <span className="font-medium text-fg">{dateOnly(range.start, ctx.tenant.timezone)} – {dateOnly(new Date(range.end.getTime() - 1), ctx.tenant.timezone)}</span></>}
        actions={<LinkButton href="/reports" variant="ghost"><ArrowLeft className="h-4 w-4" aria-hidden />All reports</LinkButton>} />
      <BranchPicker branches={ctx.branches} scope={scope} path="/reports/accounting" keep={Object.fromEntries(new URLSearchParams(rangeQuery(range)))} />
      <RangePicker range={range} path="/reports/accounting" extra={keep} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel icon={<Scale />} eyebrow="Preview" title="Journal for the period"
          actions={dr === cr ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">Out by {money(Math.abs(dr - cr), cur)}</Badge>}>
          <Table head={["Account", "Debit", "Credit", "Memo"]} empty="No activity in this period">
            {journal.map((r, i) => (
              <tr key={i}>
                <Td>{r.account}</Td>
                <Td className="text-right tabular-nums">{r.debit ? money(r.debit, cur) : ""}</Td>
                <Td className="text-right tabular-nums">{r.credit ? money(r.credit, cur) : ""}</Td>
                <Td className="max-w-xs truncate text-muted">{r.memo}</Td>
              </tr>
            ))}
            {journal.length > 0 && (
              <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold">
                <Td>Total</Td><Td className="text-right tabular-nums">{money(dr, cur)}</Td><Td className="text-right tabular-nums">{money(cr, cur)}</Td><Td />
              </tr>
            )}
          </Table>
        </Panel>

        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Panel icon={<FileSpreadsheet />} eyebrow="CSV files" title="Download">
            <ul className="space-y-3">
              {Object.entries(DOCS).map(([key, d]) => (
                <li key={key}>
                  <a href={qs(key)} download className="group flex items-start gap-3 rounded border border-line p-3 transition hover:border-line-strong hover:bg-surface-2">
                    <Download className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                    <span><span className="block text-sm font-medium text-fg">{d.label}</span><span className="block text-xs text-muted">{d.hint}</span></span>
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-subtle">Amounts are in {cur} with two decimals. Sales revenue is split by tax rate; stock is valued at FEFO batch cost.</p>
          </Panel>
          <Panel icon={<Webhook />} eyebrow="E-invoicing" title="Send each sale as it happens">
            <p className="text-sm text-muted">For e-invoicing (for example TaxBridge) or live accounting sync, add a webhook in <A href="/settings/webhooks">Settings → Webhooks</A>. Each event is a signed JSON POST (<code className="font-mono text-xs">X-PharmaStock-Signature: sha256=…</code>, HMAC of the body with your webhook secret) shaped <code className="font-mono text-xs">{"{ event, data, createdAt }"}</code>.</p>
            <dl className="mt-4 space-y-2 text-xs">
              {WEBHOOKS.map(([e, data]) => (
                <div key={e}><dt className="font-mono font-medium text-fg">{e}</dt><dd className="font-mono text-muted">{data}</dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-subtle">Fetch full sale lines with <code className="font-mono">GET /api/v1/sales/{"{id}"}</code> using an API key.</p>
          </Panel>
        </div>
      </div>
      {dr !== cr && <div className="mt-6"><Callout tone="red">The journal does not balance for this period. Please tell PharmaStock support so we can check it.</Callout></div>}
    </>
  );
}
