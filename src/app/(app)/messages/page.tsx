import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, Filter, MessagesSquare, Search, Send, TriangleAlert } from "lucide-react";
import { Badge, Button, cx, Input, Kpi, LinkButton, PageHeader, Panel, Select, Table, Td } from "@/components/ui";
import { ChannelIcon } from "./channel-icon";
import { customers, messageLog, suppliers } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { addDays, dateTime, dayRange, localDay } from "@/lib/format";
import { ALL_PURPOSE_LABELS, MessageTabs } from "./tabs";

export const metadata = { title: "Messages" };

const STATUS_TONE = { queued: "gray", sent: "blue", delivered: "teal", read: "green", failed: "red", skipped: "yellow" } as const;
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : undefined);

export default async function MessagesPage({ searchParams }: PageProps<"/messages">) {
  const ctx = await requireCtx("messaging.send");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone;
  const today = localDay(tz);
  const f = {
    channel: pick(sp.channel, ["whatsapp", "sms", "email"] as const),
    status: pick(sp.status, ["queued", "sent", "delivered", "read", "failed", "skipped"] as const),
    purpose: typeof sp.purpose === "string" && sp.purpose ? sp.purpose : undefined,
    from: day(sp.from), to: day(sp.to), q: String(sp.q ?? "").trim(),
  };
  const monthStart = dayRange(`${today.slice(0, 7)}-01`, tz).start;

  const { rows, stats, optedIn, purposes } = await tx(ctx, async (t) => {
    const like = `%${f.q}%`;
    const rows = await t.select({ m: messageLog, c: { id: customers.id, name: customers.name, customerNo: customers.customerNo }, s: { id: suppliers.id, name: suppliers.name } })
      .from(messageLog).leftJoin(customers, eq(customers.id, messageLog.customerId)).leftJoin(suppliers, eq(suppliers.id, messageLog.supplierId))
      .where(and(
        f.channel ? eq(messageLog.channel, f.channel) : undefined, f.status ? eq(messageLog.status, f.status) : undefined,
        f.purpose ? eq(messageLog.purpose, f.purpose) : undefined,
        f.from ? gte(messageLog.createdAt, dayRange(f.from, tz).start) : undefined, f.to ? lt(messageLog.createdAt, dayRange(f.to, tz).end) : undefined,
        f.q ? or(ilike(customers.customerNo, like), ilike(customers.name, like), ilike(suppliers.name, like), ilike(messageLog.to, like)) : undefined,
      )).orderBy(desc(messageLog.createdAt)).limit(200);
    const [stats] = await t.select({
      sent: sql<number>`count(*) filter (where ${inArray(messageLog.status, ["queued", "sent", "delivered", "read"])})::int`,
      failed: sql<number>`count(*) filter (where ${messageLog.status} = 'failed')::int`,
      skipped: sql<number>`count(*) filter (where ${messageLog.status} = 'skipped')::int`,
    }).from(messageLog).where(and(eq(messageLog.direction, "out"), gte(messageLog.createdAt, monthStart)));
    const [{ optedIn }] = await t.select({ optedIn: sql<number>`count(*) filter (where ${customers.messagingConsent} and ${customers.optedOutAt} is null)::int` })
      .from(customers).where(isNull(customers.deletedAt));
    const purposes = (await t.selectDistinct({ purpose: messageLog.purpose }).from(messageLog)).map((r) => r.purpose).sort();
    await audit(t, ctx, "view", "message_log", null, { details: f });
    return { rows, stats, optedIn, purposes };
  });

  return (
    <>
      <PageHeader icon={<MessagesSquare />} eyebrow="Customer messaging" title="Messages" subtitle="WhatsApp first, SMS fallback. Every message records its purpose; refill reminders and announcements only go to customers who opted in."
        actions={<LinkButton href="/messages/send"><Send className="h-4 w-4" />Send message</LinkButton>} />
      <MessageTabs current="log" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Sent this month" icon={<ArrowUpRight />} value={stats.sent} sub="receipts, reminders, summaries and orders" />
        <Kpi label="Not delivered" icon={<TriangleAlert />} value={stats.failed} sub={`${stats.skipped} skipped (opted out or no contact)`} tone={stats.failed ? "red" : "green"} href="/messages?status=failed" />
        <Kpi label="Customers opted in" icon={<BadgeCheck />} value={optedIn} sub="can get refill reminders" tone="teal" />
      </div>
      <Panel eyebrow="Log" title={`${rows.length} message${rows.length === 1 ? "" : "s"}`}>
        <form className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={f.q} placeholder="Customer, supplier or number…" className="pl-10" aria-label="Search" />
          </div>
          <Select name="channel" defaultValue={f.channel ?? ""} aria-label="Channel"><option value="">All channels</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></Select>
          <Select name="status" defaultValue={f.status ?? ""} aria-label="Status"><option value="">All statuses</option>{Object.keys(STATUS_TONE).map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="purpose" defaultValue={f.purpose ?? ""} aria-label="Purpose"><option value="">All purposes</option>{purposes.map((p) => <option key={p} value={p}>{ALL_PURPOSE_LABELS[p] ?? p}</option>)}</Select>
          <Input type="date" name="from" defaultValue={f.from} max={today} aria-label="From" />
          <div className="flex gap-2"><Input type="date" name="to" defaultValue={f.to} max={addDays(today, 1)} aria-label="To" /><Button variant="secondary" aria-label="Filter"><Filter className="h-4 w-4" /></Button></div>
        </form>
        <Table head={["", "To", "Purpose", "Message", "Status", "When"]} empty="No messages match these filters.">
          {rows.map(({ m, c, s }) => (
            <tr key={m.id} className="align-top">
              <Td className="pr-0"><div className="flex items-center gap-1.5"><ChannelIcon channel={m.channel} />{m.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5 text-accent" aria-label="inbound" /> : <ArrowUpRight className="h-3.5 w-3.5 text-subtle" aria-label="outbound" />}</div></Td>
              <Td>
                {c ? <Link href={`/customers/${c.id}`} className="font-medium text-fg hover:text-accent">{c.name}</Link>
                  : s ? <Link href={`/suppliers/${s.id}`} className="font-medium text-fg hover:text-accent">{s.name}</Link>
                  : <span className="text-muted">{m.to}</span>}
                <div className="font-mono text-xs text-muted">{c?.customerNo ?? (s ? "Supplier" : "")}</div>
              </Td>
              <Td><span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs text-muted">{ALL_PURPOSE_LABELS[m.purpose] ?? m.purpose}</span></Td>
              <Td className={cx("min-w-64 max-w-md whitespace-normal text-xs", m.direction === "in" ? "text-fg" : "text-muted")}>{m.body}{m.error && <div className="mt-1 text-bad">{m.error}</div>}</Td>
              <Td><Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge></Td>
              <Td className="text-xs text-muted">{dateTime(m.createdAt, tz)}</Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
