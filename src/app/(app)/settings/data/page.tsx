import { and, desc, eq, inArray } from "drizzle-orm";
import { Ban, Download, Eye, Lock, ShieldCheck, Trash2, TriangleAlert, Unlock } from "lucide-react";
import type { ReactNode } from "react";
import { ActionForm, Submit } from "@/components/form";
import { A, Callout, Field, IconTile, Input, Panel, Textarea } from "@/components/ui";
import { auditLog } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateOnly } from "@/lib/format";
import { rulesFor } from "@/lib/compliance";
import { cancelDeletionAction, requestDeletionAction } from "./actions";


export const metadata = { title: "Your data" };
export default async function DataOwnershipPage() {
  const ctx = await requireCtx("settings.manage");
  const [last] = await tx(ctx, (t) => t.select().from(auditLog)
    .where(and(eq(auditLog.entity, "tenant"), inArray(auditLog.action, ["deletion_request", "deletion_cancel"]))).orderBy(desc(auditLog.at)).limit(1));
  const pending = last?.action === "deletion_request" ? (last.details as { deleteAfter?: string } | null)?.deleteAfter : null;
  const rules = rulesFor(ctx.tenant.country);
  const promises: [ReactNode, string, ReactNode][] = [
    [<ShieldCheck key="i" />, "You own your pharmacy's data.", <>Products, stock, sales, customer records, prescriptions and registers belong to {ctx.tenant.name}, not to PharmaStock. We hold them only to run the service for you.</>],
    [<Download key="i" />, "Export anytime, free.", <>One click on the <A href="/settings/export">Export page</A> gives you everything in open formats (CSV and JSON, plus your uploaded files). Export is included in every plan and is never a paid extra.</>],
    [<Unlock key="i" />, "Never locked out.", <>If a payment is missed, your account becomes read-only after a grace period. You can still sign in, look up every customer and sale, print registers and export — you just can&apos;t add new records until you renew.</>],
    [<Ban key="i" />, "We don't sell or share it.", <>We never sell customer or prescription data or use it for advertising. Messages go to customers only for the purposes they agreed to.</>],
    [<Lock key="i" />, "Protected.", <>Allergies, diagnoses and register addresses are encrypted, every prescription view and stock or price change is logged in the <A href="/settings/audit">audit log</A>, and each pharmacy&apos;s data is isolated from every other pharmacy&apos;s at the database level.</>],
    [<Trash2 key="i" />, "Deleted when you ask.", <>You can ask us to delete your account. We wait 30 days (in case of mistakes), then permanently delete your data from our systems; backups roll off within a further 30 days.</>],
  ];
  return (
    <>
      <section className="sheet relative overflow-hidden p-6 sm:p-8">
        <div className="relative">
          <div className="text-[11px] font-mono uppercase tracking-wider text-accent">Our promise</div>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-fg">Your data is <span className="text-brand">yours</span></h2>
        </div>
        <div className="relative mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {promises.map(([icon, title, body]) => (
            <div key={title} className="rounded-md border border-line bg-surface p-4">
              <IconTile>{icon}</IconTile>
              <h3 className="mt-3 text-sm font-semibold text-fg">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {ctx.user.role === "owner" ? (
        <Panel title="Request account deletion" eyebrow="Danger zone" icon={<TriangleAlert />} className="border-bad/30">
          {pending ? (
            <ActionForm action={cancelDeletionAction} className="space-y-4">
              <Callout tone="red" icon={<TriangleAlert />}>Deletion has been requested. Your data will be permanently deleted after {dateOnly(pending, ctx.tenant.timezone)}.</Callout>
              <Submit variant="secondary">Cancel deletion request</Submit>
            </ActionForm>
          ) : (
            <ActionForm action={requestDeletionAction} className="max-w-xl space-y-4">
              <ol className="space-y-3 text-sm text-muted">
                {[
                  <><A href="/settings/export">Download a full export first</A>. Prescriptions and the controlled-drug register must be kept for at least {rules.retentionYears} years ({rules.regulator}) — keep your copy.</>,
                  <>After you request deletion, you have 30 days to change your mind. The account keeps working in the meantime.</>,
                  <>After 30 days all stock, sales, customer records, prescriptions, registers, files and staff accounts are permanently deleted. This cannot be undone.</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-bad/30 bg-bad/12 text-xs font-semibold text-bad tabular-nums">{i + 1}</span>
                    <span className="pt-0.5">{step}</span>
                  </li>
                ))}
              </ol>
              <Field label="Reason (optional)"><Textarea name="reason" rows={2} /></Field>
              <Field label='Type "DELETE" to confirm'><Input name="confirm" autoComplete="off" required className="font-mono" /></Field>
              <Submit variant="danger">Request deletion</Submit>
            </ActionForm>
          )}
        </Panel>
      ) : (
        <Callout tone="gray" icon={<Eye />}>Only the pharmacy owner can request account deletion.</Callout>
      )}
    </>
  );
}
