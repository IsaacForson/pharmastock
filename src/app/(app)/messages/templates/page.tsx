import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { FileText, Globe, Languages, MessageSquareText, Plus } from "lucide-react";
import { Badge, Button, Check, cx, Field, Input, PageHeader, Panel } from "@/components/ui";
import { TemplateEditor } from "../composer";
import { messageTemplates } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { DEFAULT_TEMPLATES } from "@/lib/messaging";
import { can } from "@/lib/permissions";
import { saveTemplateAction } from "../actions";
import { MessageTabs } from "../tabs";

export const metadata = { title: "Message templates" };

const placeholders = (body: string) => [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];

export default async function TemplatesPage({ searchParams }: PageProps<"/messages/templates">) {
  const ctx = await requireCtx("messaging.send");
  const sp = await searchParams;
  const rows = await tx(ctx, (t) => t.select().from(messageTemplates).orderBy(messageTemplates.key, messageTemplates.language));
  const keys = [...new Set([...Object.keys(DEFAULT_TEMPLATES), ...rows.map((r) => r.key)])].sort();
  const key = typeof sp.key === "string" && keys.includes(sp.key) ? sp.key : keys[0];
  const lang = typeof sp.lang === "string" && /^[a-z]{2,3}$/.test(sp.lang) ? sp.lang : "en";
  const current = rows.find((r) => r.key === key && r.language === lang);
  const body = current?.body ?? DEFAULT_TEMPLATES[key] ?? "";
  const langs = [...new Set(["en", ...rows.filter((r) => r.key === key).map((r) => r.language)])];
  const editable = can(ctx.user.role, "settings.manage") && ctx.access === "full";

  const ph = [...new Set(["name", "pharmacy", ...placeholders(DEFAULT_TEMPLATES[key] ?? body)])];
  return (
    <>
      <PageHeader icon={<MessageSquareText />} eyebrow="Customer messaging" title="Templates" subtitle="The words customers and suppliers receive for receipts, refill reminders, orders and more — in every language you support." />
      <MessageTabs current="templates" />
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Panel eyebrow="Library" title={`${keys.length} templates`} icon={<FileText />} bodyClassName="p-2">
          <ul className="space-y-0.5">
            {keys.map((k) => (
              <li key={k}><Link href={`/messages/templates?key=${k}`} aria-current={k === key ? "page" : undefined}
                className={cx("flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm capitalize transition", k === key ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                <span className="truncate">{k.replace(/_/g, " ")}</span>
                {rows.some((r) => r.key === k && r.waTemplateName) && <Badge tone="green">WA</Badge>}
              </Link></li>
            ))}
          </ul>
        </Panel>
        <Panel glow eyebrow={current ? "Customised" : "Default text"} title={<span className="capitalize">{key.replace(/_/g, " ")}</span>} icon={<MessageSquareText />}
          actions={<div className="flex gap-1 rounded-xl border border-line bg-surface p-1">{langs.map((l) => (
            <Link key={l} href={`/messages/templates?key=${key}&lang=${l}`} aria-current={l === lang ? "page" : undefined}
              className={cx("rounded-lg px-2.5 py-1 font-mono text-xs uppercase transition", l === lang ? "bg-aurora text-on-accent" : "text-muted hover:text-fg")}>{l}</Link>
          ))}</div>}>
          <ActionForm action={saveTemplateAction} key={`${key}-${lang}`} className="space-y-5">
            <input type="hidden" name="key" value={key} />
            <input type="hidden" name="language" value={lang} />
            <TemplateEditor defaultValue={body} disabled={!editable} placeholders={ph} sample={{ name: "Ama", pharmacy: ctx.tenant.name, sale: "SL-000123", amount: "GHS 85.00", items: "Metformin 500 mg", date: "12 Nov", po: "PO-000045", supplier: "Ernest Chemists", status: "ready for pickup", lines: "12", link: "https://…" }}
              hint="Click a placeholder to insert it — {{name}} and {{pharmacy}} are always available." />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="Approved WhatsApp template name" hint="Needed to message customers outside the 24-hour window. Parameters must follow the same order as the placeholders above.">
                <Input name="waTemplateName" defaultValue={current?.waTemplateName ?? ""} placeholder="refill_reminder_v1" disabled={!editable} className="font-mono" />
              </Field>
              <Check name="active" defaultChecked={current?.active ?? true} disabled={!editable} label="Active" className="h-10" />
            </div>
            {editable && <div className="flex justify-end"><Submit>Save template</Submit></div>}
          </ActionForm>
          {editable && (
            <form className="mt-6 flex flex-wrap items-end gap-2 border-t border-line pt-5">
              <input type="hidden" name="key" value={key} />
              <Field label="Add a language (code, e.g. tw, ha, sw, fr)"><div className="relative"><Languages className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden /><Input name="lang" pattern="[a-z]{2,3}" required className="w-36 pl-9 font-mono" /></div></Field>
              <Button variant="secondary"><Plus className="h-4 w-4" />Open</Button>
            </form>
          )}
          {!editable && <p className="mt-4 flex items-center gap-2 text-xs text-subtle"><Globe className="h-3.5 w-3.5" />Only the owner or manager can edit templates.</p>}
        </Panel>
      </div>
    </>
  );
}
