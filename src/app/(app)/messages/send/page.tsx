import { and, eq, ilike, isNull, or } from "drizzle-orm";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { AlertTriangle, Search, Send, ShieldCheck, UserPlus } from "lucide-react";
import { A, Avatar, Badge, Callout, EmptyState, Field, Input, LinkButton, PageHeader, Panel, Select } from "@/components/ui";
import { SendFields } from "../composer";
import { customers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { DEFAULT_TEMPLATES } from "@/lib/messaging";
import { sendAdhocAction } from "../actions";
import { MessageTabs, NEEDS_OPT_IN, PURPOSE_LABELS } from "../tabs";

export const metadata = { title: "Send message" };

// Templates staff may pick for a one-off; operational ones (owner summary, purchase orders) are sent by the system.
const CUSTOMER_TEMPLATES = Object.fromEntries(Object.entries(DEFAULT_TEMPLATES).filter(([k]) => !["owner_summary", "purchase_order", "receipt"].includes(k)));

export default async function SendPage({ searchParams }: PageProps<"/messages/send">) {
  const ctx = await requireCtx("messaging.send");
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const customerId = typeof sp.customer === "string" && /^[0-9a-f-]{36}$/i.test(sp.customer) ? sp.customer : null;
  const { customer, matches } = await tx(ctx, async (t) => {
    const [customer] = customerId ? await t.select().from(customers).where(and(eq(customers.id, customerId), isNull(customers.deletedAt))) : [];
    const like = `%${q}%`;
    const matches = !customer && q ? await t.select().from(customers).where(and(isNull(customers.deletedAt), or(
      ilike(customers.customerNo, like), ilike(customers.name, like), ilike(customers.phone, like),
    ))).limit(20) : [];
    return { customer, matches };
  });
  const consent = customer?.optedOutAt ? "out" : customer?.messagingConsent ? "in" : "none";

  return (
    <>
      <PageHeader icon={<Send />} eyebrow="Customer messaging" title="Send message" subtitle="One-off messages. The purpose is recorded with every message, and opt-outs are always respected." />
      <MessageTabs current="send" />
      {!customer ? (
        <Panel icon={<Search />} eyebrow="Step 1" title="Choose a customer" className="max-w-3xl">
          <form className="relative mb-4">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Name, customer number or phone…" autoFocus className="h-12 pl-10 text-base" aria-label="Search customers" />
          </form>
          {!q ? <p className="py-6 text-center text-sm text-muted">Type a name, customer number or phone and press Enter.</p>
            : matches.length === 0 ? <EmptyState icon={<UserPlus />} title="No customers match"><A href="/customers/new">Add the customer</A> first.</EmptyState> : (
            <ul className="space-y-1">
              {matches.map((c) => (
                <li key={c.id}>
                  <Link href={`/messages/send?customer=${c.id}`} className="flex items-center gap-3 rounded px-3 py-2.5 transition hover:bg-surface-2">
                    <Avatar name={c.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{c.name}</div>
                      <div className="truncate text-xs text-muted"><span className="font-mono">{c.customerNo}</span>{c.phone && ` · ${c.phone}`}</div>
                    </div>
                    <span className="text-xs font-medium text-accent">Select →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Panel eyebrow="Compose" title={`Message ${customer.name.split(" ")[0]}`} icon={<Send />} glow>
            {consent === "out" && <div className="mb-4"><Callout tone="yellow" icon={<AlertTriangle />}>This customer has opted out of messages. Nothing will be sent.</Callout></div>}
            {consent === "none" && <div className="mb-4"><Callout tone="blue" icon={<ShieldCheck />}>No opt-in on file: {[...NEEDS_OPT_IN].map((p) => PURPOSE_LABELS[p as keyof typeof PURPOSE_LABELS].toLowerCase()).join(", ")} messages will be skipped. Record their consent on the customer&apos;s page first.</Callout></div>}
            <ActionForm action={sendAdhocAction} resetOnSuccess className="space-y-4">
              <input type="hidden" name="customerId" value={customer.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Purpose">
                  <Select name="purpose" defaultValue="service">{Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}{NEEDS_OPT_IN.has(k) ? " (opt-in)" : ""}</option>)}</Select>
                </Field>
                <Field label="Channel">
                  <Select name="channel" defaultValue={customer.preferredChannel}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></Select>
                </Field>
              </div>
              <SendFields templates={CUSTOMER_TEMPLATES} sample={{ name: customer.name.split(" ")[0], pharmacy: ctx.tenant.name }} />
              <div className="flex justify-end"><Submit size="lg" disabled={consent === "out"}><Send className="h-4 w-4" />Send</Submit></div>
            </ActionForm>
          </Panel>
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Panel eyebrow="Recipient">
              <div className="flex flex-col items-center gap-3 text-center">
                <Avatar name={customer.name} size="lg" />
                <div>
                  <div className="text-base font-semibold text-fg">{customer.name}</div>
                  <div className="font-mono text-xs text-muted">{customer.customerNo}</div>
                  <div className="mt-1 text-xs text-muted">{customer.phone ?? customer.email ?? "no contact"}</div>
                </div>
                {consent === "out" ? <Badge tone="yellow">opted out</Badge> : consent === "in" ? <Badge tone="green">opted in{customer.consentMethod ? ` · ${customer.consentMethod}` : ""}</Badge> : <Badge>no opt-in</Badge>}
                <LinkButton variant="ghost" size="sm" href="/messages/send">Change customer</LinkButton>
              </div>
              <p className="mt-4 flex items-start gap-2 border-t border-line pt-4 text-[11px] text-subtle"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />Opt-out always wins: messages to opted-out customers are skipped and logged.</p>
            </Panel>
          </aside>
        </div>
      )}
    </>
  );
}
