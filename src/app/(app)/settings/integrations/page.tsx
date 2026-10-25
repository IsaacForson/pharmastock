import { CreditCard, Lock, Mail, MessageCircle, MessageSquareText, Plug, Send } from "lucide-react";
import type { ReactNode } from "react";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { Check, Field, Input, Panel, Select, StatusDot } from "@/components/ui";
import { integrations } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { removeIntegrationAction, saveIntegrationAction, testSendAction } from "./actions";
import { mask, PROVIDERS } from "./providers";

export const metadata = { title: "Integrations" };
const ICON: Record<string, ReactNode> = { whatsapp: <MessageCircle />, africastalking: <MessageSquareText />, twilio: <MessageSquareText />, paystack: <CreditCard />, resend: <Mail /> };

export default async function IntegrationsPage() {
  const ctx = await requireCtx("settings.manage");
  const rows = await tx(ctx, (t) => t.select().from(integrations));
  const byProvider = Object.fromEntries(rows.map((r) => [r.provider, { active: r.active, config: JSON.parse(r.config) as Record<string, string> }]));
  const connected = rows.filter((r) => r.active).length;
  return (
    <>
      <div className="glass flex flex-wrap items-center gap-4 p-5 animate-rise">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-accent/25 bg-accent/15 text-accent" aria-hidden><Lock className="h-5 w-5" /></span>
        <p className="min-w-0 flex-1 text-sm text-muted">
          <span className="font-medium text-fg">{connected} of {Object.keys(PROVIDERS).length} connected.</span> Connect your own accounts — credentials are encrypted at rest and never shown in full again. Without your own, PharmaStock&apos;s shared senders are used.
        </p>
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        {Object.entries(PROVIDERS).map(([key, p]) => {
          const cur = byProvider[key];
          const secrets = cur ? p.fields.filter((f) => f.secret && cur.config[f.key]) : [];
          return (
            <Panel key={key} icon={ICON[key] ?? <Plug />} title={p.name} glow={cur?.active}
              eyebrow={<span className="inline-flex items-center gap-1.5">
                <StatusDot tone={cur ? (cur.active ? "green" : "yellow") : "gray"} pulse={!!cur?.active} />
                {cur ? (cur.active ? "Connected" : "Paused") : "Not connected · shared sender"}
              </span>}
              actions={cur && <ActionButton action={removeIntegrationAction} fields={{ provider: key }} variant="ghost" confirm={`Remove ${p.name} credentials?`}>Disconnect</ActionButton>}>
              <p className="mb-4 text-sm text-muted">{p.help}</p>
              {secrets.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {secrets.map((f) => (
                    <span key={f.key} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted">
                      <Lock className="h-3 w-3 text-subtle" aria-hidden />{f.label}
                      <code className="font-mono text-fg">{mask(cur!.config[f.key])}</code>
                    </span>
                  ))}
                </div>
              )}
              <ActionForm action={saveIntegrationAction} className="space-y-4">
                <input type="hidden" name="provider" value={key} />
                <div className="grid gap-4 sm:grid-cols-2">
                  {p.fields.map((f) => (
                    <Field key={f.key} label={f.label + (f.optional ? " (optional)" : "")} hint={f.secret && cur ? "Leave blank to keep the saved value" : undefined}>
                      {f.secret
                        ? <Input name={f.key} type="password" autoComplete="off" placeholder={cur ? mask(cur.config[f.key]) : ""} className="font-mono" />
                        : <Input name={f.key} defaultValue={cur?.config[f.key] ?? ""} />}
                    </Field>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
                  <Check name="active" defaultChecked={cur?.active ?? true} label="Active" />
                  <Submit variant={cur ? "secondary" : "primary"}>{cur ? "Save changes" : "Connect"}</Submit>
                </div>
              </ActionForm>
            </Panel>
          );
        })}
      </div>

      <Panel title="Send a test message" eyebrow="Check delivery" icon={<Send />}>
        <ActionForm action={testSendAction} className="grid items-end gap-4 [&>*]:mb-0! sm:grid-cols-[1fr_2fr_auto]">
          <Field label="Channel"><Select name="channel"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option></Select></Field>
          <Field label="Phone number"><Input name="to" type="tel" defaultValue={ctx.user.phone ?? ""} required /></Field>
          <Submit variant="secondary"><Send className="h-4 w-4" aria-hidden /> Send test</Submit>
        </ActionForm>
      </Panel>
    </>
  );
}
