import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { Filter, ScrollText, SearchX } from "lucide-react";
import { A, Avatar, Badge, Button, Callout, Field, Input, LinkButton, Panel, Select, Table, Td, type Tone } from "@/components/ui";
import { auditLog, customers, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime, dayRange } from "@/lib/format";

export const metadata = { title: "Audit log" };
const PER_PAGE = 50;
const ACTION_TONE: Record<string, Tone> = { view: "gray", create: "green", update: "blue", delete: "red", void: "red", return: "yellow", price: "purple", adjust: "yellow", export: "yellow", download: "yellow", login: "teal", print: "gray", send: "blue", destroy: "red" };
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  const ctx = await requireCtx("audit.view");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const f = { user: str("user"), action: str("action"), entity: str("entity"), customer: str("customer"), from: day(sp.from), to: day(sp.to) };
  const pageNo = Math.max(1, Number(str("page")) || 1);
  const tz = ctx.tenant.timezone;

  const { rows, staff, customerMatch } = await tx(ctx, async (t) => {
    const staff = await t.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
    const [customerMatch] = f.customer ? await t.select({ id: customers.id }).from(customers).where(eq(customers.customerNo, f.customer.toUpperCase())) : [];
    const rows = f.customer && !customerMatch ? [] : await t.select({ a: auditLog, userName: users.name, c: { name: customers.name, customerNo: customers.customerNo } })
      .from(auditLog).leftJoin(users, eq(users.id, auditLog.userId)).leftJoin(customers, eq(customers.id, auditLog.customerId))
      .where(and(
        f.user && /^[0-9a-f-]{36}$/.test(f.user) ? eq(auditLog.userId, f.user) : undefined,
        f.action ? eq(auditLog.action, f.action) : undefined,
        f.entity ? eq(auditLog.entity, f.entity) : undefined,
        customerMatch ? eq(auditLog.customerId, customerMatch.id) : undefined,
        f.from ? gte(auditLog.at, dayRange(f.from, tz).start) : undefined,
        f.to ? lt(auditLog.at, dayRange(f.to, tz).end) : undefined,
      )).orderBy(desc(auditLog.at)).limit(PER_PAGE + 1).offset((pageNo - 1) * PER_PAGE);
    return { rows, staff, customerMatch };
  });
  const qs = (page: number) => "?" + new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(page) });

  const filtered = Object.values(f).some(Boolean);
  return (
    <>
      <form className="sheet grid items-end gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
        <Field label="Staff">
          <Select name="user" defaultValue={f.user}><option value="">Anyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        <Field label="Action"><Input name="action" defaultValue={f.action} placeholder="view, update…" list="audit-actions" /></Field>
        <Field label="Record type"><Input name="entity" defaultValue={f.entity} placeholder="sale, product, stock_batch…" /></Field>
        <Field label="Customer no."><Input name="customer" defaultValue={f.customer} placeholder="C-000001" className="font-mono" /></Field>
        <Field label="From"><Input name="from" type="date" defaultValue={f.from} /></Field>
        <Field label="To"><Input name="to" type="date" defaultValue={f.to} /></Field>
        <div className="flex gap-2"><Button type="submit"><Filter className="h-4 w-4" aria-hidden /> Filter</Button>{filtered && <LinkButton href="/settings/audit" variant="ghost">Clear</LinkButton>}</div>
        <datalist id="audit-actions">{["view", "create", "update", "delete", "void", "return", "price", "adjust", "export", "download", "login", "print", "send"].map((a) => <option key={a} value={a} />)}</datalist>
      </form>
      {f.customer && !customerMatch && <Callout tone="yellow" icon={<SearchX />}>No customer with number {f.customer}.</Callout>}
      <Panel title="Activity" eyebrow={`Page ${pageNo}${filtered ? " · filtered" : ""}`} icon={<ScrollText />}>
        <Table head={["When", "Who", "Action", "Record", "Customer", "Details", "IP"]} empty="No matching entries.">
          {rows.slice(0, PER_PAGE).map(({ a, userName, c }) => (
            <tr key={a.id} className="text-[13px]">
              <Td className="py-2.5 font-mono text-xs text-muted tabular-nums">{dateTime(a.at, tz, { dateStyle: "medium", timeStyle: "medium" })}</Td>
              <Td className="py-2.5">{userName ? <span className="inline-flex items-center gap-2"><Avatar name={userName} size="sm" />{userName}</span> : <span className="text-muted">{a.userId ? "Unknown" : (a.details as { apiKeyId?: string } | null)?.apiKeyId ? "API key" : "System"}</span>}</Td>
              <Td className="py-2.5"><Badge tone={ACTION_TONE[a.action] ?? "gray"}>{a.action}</Badge></Td>
              <Td className="py-2.5">{a.entity}{a.entityId && <span className="ml-1.5 font-mono text-xs text-subtle">{a.entityId.slice(0, 8)}</span>}</Td>
              <Td className="py-2.5">{c?.customerNo && <A href={`/customers/${a.customerId}`}>{c.name} <span className="font-mono text-xs text-muted">{c.customerNo}</span></A>}</Td>
              <Td className="max-w-xs truncate py-2.5 font-mono text-xs text-muted" title={a.details ? JSON.stringify(a.details) : ""}>{a.details ? JSON.stringify(a.details) : ""}</Td>
              <Td className="py-2.5 font-mono text-xs text-subtle">{a.ip}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm">
          {pageNo > 1 ? <A href={qs(pageNo - 1)}>← Newer</A> : <span />}
          <span className="text-subtle tabular-nums">Page {pageNo}</span>
          {rows.length > PER_PAGE ? <A href={qs(pageNo + 1)}>Older →</A> : <span />}
        </div>
      </Panel>
    </>
  );
}
