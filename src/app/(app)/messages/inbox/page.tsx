import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { Bot, Clock, Inbox, Lock, MessagesSquare, Send } from "lucide-react";
import { Avatar, Badge, cx, EmptyState, Input, LinkButton, PageHeader } from "@/components/ui";
import { ChannelIcon } from "../channel-icon";
import { customers, messageLog } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { quickReplyAction } from "../actions";
import { MessageTabs } from "../tabs";

export const metadata = { title: "Inbox" };

/** WhatsApp's 24h customer-service window for free-text replies. */
const inReplyWindow = (d: Date) => Date.now() - d.getTime() < 24 * 3600_000;

export default async function InboxPage({ searchParams }: PageProps<"/messages/inbox">) {
  const sel = (await searchParams).c;
  const ctx = await requireCtx("messaging.send");
  const tz = ctx.tenant.timezone;
  const rows = await tx(ctx, async (t) => {
    await audit(t, ctx, "view", "message_inbox", null);
    const list = await t.select({ m: messageLog, p: { id: customers.id, name: customers.name } })
      .from(messageLog).leftJoin(customers, eq(customers.id, messageLog.customerId))
      .where(eq(messageLog.direction, "in")).orderBy(desc(messageLog.createdAt)).limit(100);
    return list.map((r) => ({ ...r, open: inReplyWindow(r.m.createdAt) }));
  });

  // Group replies into conversations by customer (or sender number); rows are newest first.
  const convos = [...rows.reduce((map, r) => {
    const k = r.p?.id ?? r.m.to;
    map.set(k, [...(map.get(k) ?? []), r]);
    return map;
  }, new Map<string, typeof rows>())].map(([k, msgs]) => ({ k, msgs, latest: msgs[0] }));
  const active = convos.find((c) => c.k === sel) ?? convos[0];
  // Full thread for the open conversation: customer replies and what the pharmacy sent, oldest first.
  const thread = active ? await tx(ctx, (t) => t.select().from(messageLog)
    .where(active.latest.p ? eq(messageLog.customerId, active.latest.p.id) : eq(messageLog.to, active.latest.m.to))
    .orderBy(desc(messageLog.createdAt)).limit(60)) : [];
  const who = (r: (typeof rows)[number]) => (r.p ? r.p.name : r.m.to);
  const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(d);
  return (
    <>
      <PageHeader icon={<Inbox />} eyebrow="Customer messaging" title="Inbox" subtitle="Replies from customers. Commands like 1 (refill ready) and STOP are handled automatically." />
      <MessageTabs current="inbox" />
      {rows.length === 0 ? <EmptyState icon={<MessagesSquare />} title="No replies yet">Customers&apos; WhatsApp and SMS replies will show here.</EmptyState> : (
        <div className="sheet grid min-h-[560px] overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <nav aria-label="Conversations" className="max-h-[70vh] overflow-y-auto border-b border-line p-2 lg:max-h-none lg:border-b-0 lg:border-r">
            {convos.map((c) => (
              <Link key={c.k} href={`/messages/inbox?c=${encodeURIComponent(c.k)}`} aria-current={c === active ? "true" : undefined}
                className={cx("flex items-start gap-3 rounded px-3 py-3 transition", c === active ? "bg-surface-3 shadow-[inset_0_0_0_1px_var(--line-strong)]" : "hover:bg-surface-2")}>
                <Avatar name={who(c.latest)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-fg">{who(c.latest)}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-subtle">{time(c.latest.m.createdAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="truncate text-xs text-muted">{c.latest.m.body}</span>
                    {c.latest.open && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent-2" aria-label="Reply window open" />}
                  </div>
                </div>
              </Link>
            ))}
          </nav>
          {active && (
            <section className="flex min-h-0 flex-col">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={who(active.latest)} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-fg">{active.latest.p ? <Link href={`/customers/${active.latest.p.id}`} className="hover:text-accent">{who(active.latest)}</Link> : who(active.latest)}</div>
                    <div className="flex items-center gap-2 text-xs text-muted"><span className="font-mono">{active.latest.m.to}</span></div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ChannelIcon channel={active.latest.m.channel} />
                  {active.latest.open ? <Badge tone="teal" pulse>reply window open</Badge> : <Badge>window closed</Badge>}
                </div>
              </header>
              <ol className="flex-1 space-y-4 overflow-y-auto px-5 py-6">
                {[...thread].reverse().map((m) => (
                  <li key={m.id} className={cx("flex max-w-[85%] flex-col gap-1", m.direction === "out" ? "ml-auto items-end" : "items-start")}>
                    <div className={cx("rounded-md px-4 py-2.5 text-sm shadow-lift", m.direction === "out" ? "rounded-br-md bg-brand text-on-accent" : "rounded-bl-md border border-line bg-surface-2 text-fg")}>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                    <div className="flex items-center gap-2 px-1 text-[11px] text-subtle">
                      <span className="tabular-nums">{dateTime(m.createdAt, tz)}</span><span className="capitalize">· {m.channel}</span>
                      {m.direction === "out" && <span className="capitalize">· {m.status}</span>}
                      {m.templateKey?.startsWith("cmd:") && <span className="inline-flex items-center gap-1 rounded-md bg-accent-2/12 px-1.5 py-0.5 text-accent-2"><Bot className="h-3 w-3" />auto: {m.templateKey.slice(4)}</span>}
                    </div>
                  </li>
                ))}
              </ol>
              <footer className="border-t border-line p-4">
                {active.latest.open ? (
                  <ActionForm action={quickReplyAction} resetOnSuccess className="flex flex-wrap gap-2 space-y-0 [&>p]:basis-full">
                    <input type="hidden" name="inboundId" value={active.latest.m.id} />
                    <Input name="body" placeholder={`Reply to ${who(active.latest)}…`} required maxLength={1000} className="h-11 w-auto min-w-0 flex-1" aria-label="Reply" />
                    <Submit size="md" className="h-11"><Send className="h-4 w-4" />Reply</Submit>
                  </ActionForm>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface px-4 py-3 text-sm text-muted">
                    <span className="flex items-center gap-2"><Lock className="h-4 w-4" />Reply window (24h) has closed.</span>
                    <LinkButton size="sm" variant="secondary" href={active.latest.p ? `/messages/send?customer=${active.latest.p.id}` : "/messages/send"}>Send message</LinkButton>
                  </div>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle"><Clock className="h-3 w-3" />Free-text replies are only possible within 24h of the customer&apos;s last message.</p>
              </footer>
            </section>
          )}
        </div>
      )}
    </>
  );
}
