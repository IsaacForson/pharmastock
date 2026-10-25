import { desc, eq } from "drizzle-orm";
import { Ban, BellRing, Building2, CalendarPlus, CreditCard, Eye, NotebookPen, Receipt, ScrollText, ShieldAlert, Trash2, Users } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm, Submit } from "@/components/form";
import { Avatar, Badge, Callout, Dl, Field, Input, Kpi, PageHeader, Panel, Select, Table, Td, Textarea, Timeline } from "@/components/ui";
import { adminDb } from "@/db";
import { billingEvents, platformAdmins, platformAudit, tenants, users } from "@/db/schema";
import { dateOnly, dateTime, money } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { platformCan, requireAdmin } from "@/lib/platform-auth";
import { deletionRequests, pharmacyMrr, pharmacyStats } from "@/lib/platform-metrics";
import { controlMoney } from "../../money";
import { PLANS } from "@/lib/plans";
import {
  deletePharmacyAction, extendTrialAction, savePharmacyNotesAction, setSuspendedAction, startSupportViewAction, updatePharmacyBillingAction,
} from "../../actions";

export const metadata = { title: "Pharmacy" };

const STATUS_TONE = { active: "green", trialing: "purple", past_due: "yellow", read_only: "red", cancelled: "gray", suspended: "red" } as const;

export default async function PharmacyDetail({ params }: PageProps<"/admin/pharmacies/[id]">) {
  const { id } = await params;
  const ctx = await requireAdmin();
  const role = ctx.admin.role;
  const { m, fmt, display } = await controlMoney(ctx.admin);
  const db = adminDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t) notFound();
  const [stats, staff, events, log, [deletion]] = await Promise.all([
    pharmacyStats(id),
    db.select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt })
      .from(users).where(eq(users.tenantId, id)).orderBy(users.createdAt),
    db.select().from(billingEvents).where(eq(billingEvents.tenantId, id)).orderBy(desc(billingEvents.createdAt)).limit(20),
    db.select({ l: platformAudit, by: platformAdmins.name }).from(platformAudit).leftJoin(platformAdmins, eq(platformAdmins.id, platformAudit.adminId))
      .where(eq(platformAudit.tenantId, id)).orderBy(desc(platformAudit.at)).limit(30),
    deletionRequests(id),
  ]);
  const st = t.suspendedAt ? "suspended" : t.planStatus;
  const mrr = pharmacyMrr(m, t);
  const localList = m.lists.get(t.currency);
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  return (
    <>
      <PageHeader eyebrow="Pharmacy" icon={<Building2 />} title={t.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[st as keyof typeof STATUS_TONE] ?? "gray"}>{st.replace("_", " ")}</Badge>{PLANS[t.plan].name} · {t.billingCycle} · {t.country} · joined {dateOnly(t.createdAt, "UTC")}</span>} />

      {t.suspendedAt && <div className="mb-4"><Callout tone="red" icon={<Ban />}>Suspended {dateTime(t.suspendedAt, "UTC")}: {t.suspendReason}</Callout></div>}
      {deletion && <div className="mb-4"><Callout tone="yellow" icon={<Trash2 />}>Owner requested deletion on {dateOnly(deletion.requestedAt, "UTC")}{deletion.by ? ` (${deletion.by})` : ""}. Earliest deletion: {deletion.deleteAfter?.slice(0, 10)}.</Callout></div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="MRR" value={money(mrr.local, t.currency)} sub={`${t.currency !== display ? `≈ ${fmt(mrr.display)} · ` : ""}${t.plan === "chain" ? `${t.billedBranches} billed branches` : "single branch"}`} icon={<CreditCard />} />
        <Kpi label="Sales" value={money(stats.gmv30, t.currency)} sub={`${stats.sales30} sales in 30 days · ${stats.offline30} offline`} icon={<Receipt />} tone="green" />
        <Kpi label="Expiring in 90 days" value={money(stats.expiring90, t.currency)} sub={`${stats.openAlerts} open alerts`} icon={<BellRing />} tone="yellow" />
        <Kpi label="Messages" value={stats.messages30} sub="this month" icon={<ScrollText />} tone="blue" />
      </section>

      <section className="mt-6 grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-7">
          <Panel title="Pharmacy details" icon={<Building2 />}>
            <Dl items={[
              ["Pharmacy ID", <span key="i" className="font-mono text-xs">{t.id}</span>], ["Slug", t.slug], ["Contact", [t.email, t.phone].filter(Boolean).join(" · ")],
              ["Address", t.address], ["Licence no.", t.licenceNo], ["Superintendent", [t.superintendent, t.superintendentRegNo].filter(Boolean).join(" · ")],
              ["Currency / timezone", `${t.currency} · ${t.timezone}`], ["Branches", `${stats.branches} active · ${t.billedBranches} billed`],
              ["Products", stats.products.toLocaleString()], ["Customers", stats.customers.toLocaleString()],
              ["Trial ends", t.trialEndsAt ? dateOnly(t.trialEndsAt, "UTC") : null], ["Period ends", t.currentPeriodEnd ? dateOnly(t.currentPeriodEnd, "UTC") : null],
              ["Last staff login", stats.lastLogin ? dateTime(stats.lastLogin, "UTC") : "never"],
            ]} />
          </Panel>

          <Panel title="Staff accounts" eyebrow={`${staff.filter((s) => s.active).length} active`} icon={<Users />}>
            <Table head={["Name", "Role", "Login", "Last sign-in"]}>
              {staff.map((s) => (
                <tr key={s.id} className={s.active ? undefined : "opacity-50"}>
                  <Td><span className="flex items-center gap-2"><Avatar name={s.name} size="sm" />{s.name}</span></Td>
                  <Td><Badge tone={s.role === "owner" ? "purple" : "gray"}>{ROLE_LABELS[s.role]}</Badge></Td>
                  <Td className="text-xs text-muted">{s.email ?? s.phone}</Td>
                  <Td className="text-muted">{s.lastLoginAt ? dateTime(s.lastLoginAt, "UTC") : "never"}</Td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="Subscription payments" icon={<CreditCard />}>
            <Table head={["When", "Event", "Amount", "Reference"]} empty="No subscription events yet.">
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="text-muted">{dateTime(e.createdAt, "UTC")}</Td><Td><Badge tone={e.type === "charge.success" ? "green" : e.type.includes("fail") || e.type.includes("disable") ? "red" : "gray"}>{e.type}</Badge></Td>
                  <Td className="tabular-nums">{e.amountMinor != null ? money(e.amountMinor, e.currency ?? "USD") : "—"}</Td><Td className="font-mono text-xs text-subtle">{e.providerRef}</Td>
                </tr>
              ))}
            </Table>
          </Panel>

          <Panel title="Control activity for this pharmacy" icon={<ScrollText />}>
            {log.length === 0 ? <p className="text-sm text-muted">No team actions yet.</p> : (
              <Timeline items={log.map(({ l, by }) => ({ id: l.id, title: l.action.replaceAll("_", " "), meta: `${by ?? "system"} · ${dateTime(l.at, "UTC")}`, tone: l.action.includes("delete") || l.action.includes("suspend") ? "red" : l.action.includes("support") ? "yellow" : "purple" }))} />
            )}
          </Panel>
        </div>

        <div className="space-y-4 xl:col-span-5">
          {platformCan(role, "pharmacies.impersonate") && (
            <Panel title="Support view" eyebrow="Read-only · audited" icon={<Eye />}>
              <p className="mb-3 text-sm text-muted">Open the pharmacy&apos;s app as its owner for one hour to troubleshoot. Nothing can be changed, and the pharmacy&apos;s own audit trail shows your visit.</p>
              <ActionForm action={startSupportViewAction} className="space-y-3">
                <input type="hidden" name="tenantId" value={t.id} />
                <Input name="reason" placeholder="Reason, e.g. ticket #1234 — till not syncing" required minLength={5} />
                <Submit variant="secondary" className="w-full"><Eye className="h-4 w-4" />Open support view</Submit>
              </ActionForm>
            </Panel>
          )}

          {platformCan(role, "pharmacies.billing") && (
            <Panel title="Subscription" icon={<CreditCard />} glow>
              <ActionForm action={updatePharmacyBillingAction} className="grid gap-3 sm:grid-cols-2 [&>*]:mb-0!">
                <input type="hidden" name="tenantId" value={t.id} />
                <Field label="Plan"><Select name="plan" defaultValue={t.plan}>{Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.name} · {money(localList?.plans[k as keyof typeof PLANS] ?? 0, t.currency)}</option>)}</Select></Field>
                <Field label="Status"><Select name="planStatus" defaultValue={t.planStatus}>{["trialing", "active", "past_due", "read_only", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></Field>
                <Field label="Billing cycle"><Select name="billingCycle" defaultValue={t.billingCycle}><option value="monthly">Monthly</option><option value="annual">Annual</option></Select></Field>
                <Field label="Billed branches" hint="Chain only; at least 3 and never fewer than active branches"><Input name="billedBranches" type="number" min={1} max={500} defaultValue={t.billedBranches} /></Field>
                <Field label="Current period ends" className="sm:col-span-2"><Input name="currentPeriodEnd" type="date" defaultValue={day(t.currentPeriodEnd)} /></Field>
                <div className="sm:col-span-2"><Submit className="w-full">Save subscription</Submit></div>
              </ActionForm>
              <ActionForm action={extendTrialAction} className="mt-4 flex items-end gap-2 border-t border-line pt-4 [&>*]:mb-0!">
                <input type="hidden" name="tenantId" value={t.id} />
                <Field label="Extend trial by" className="flex-1"><Select name="days" defaultValue="7"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></Select></Field>
                <Submit variant="secondary"><CalendarPlus className="h-4 w-4" />Extend</Submit>
              </ActionForm>
            </Panel>
          )}

          {platformCan(role, "pharmacies.notes") && (
            <Panel title="Internal notes" eyebrow="Only the PharmaStock team sees these" icon={<NotebookPen />}>
              <ActionForm action={savePharmacyNotesAction} className="space-y-3">
                <input type="hidden" name="tenantId" value={t.id} />
                <Textarea name="notes" rows={5} defaultValue={t.adminNotes ?? ""} placeholder="Onboarding status, contacts, agreements…" />
                <Submit variant="secondary" size="sm">Save notes</Submit>
              </ActionForm>
            </Panel>
          )}

          {(platformCan(role, "pharmacies.suspend") || platformCan(role, "pharmacies.delete")) && (
            <Panel title="Danger zone" icon={<ShieldAlert />} className="border-bad/30">
              {platformCan(role, "pharmacies.suspend") && (
                <ActionForm action={setSuspendedAction} className="space-y-3">
                  <input type="hidden" name="tenantId" value={t.id} />
                  <input type="hidden" name="suspend" value={t.suspendedAt ? "0" : "1"} />
                  {!t.suspendedAt && <Input name="reason" placeholder="Reason (abuse, fraud, legal request…)" />}
                  <p className="text-xs text-muted">{t.suspendedAt ? "Staff will be able to sign in again." : "Signs every staff member out and blocks sign-in. Data is not touched. For unpaid accounts use read-only status instead."}</p>
                  <Submit variant={t.suspendedAt ? "secondary" : "danger"} size="sm"><Ban className="h-4 w-4" />{t.suspendedAt ? "Reactivate pharmacy" : "Suspend pharmacy"}</Submit>
                </ActionForm>
              )}
              {platformCan(role, "pharmacies.delete") && deletion && (
                <ActionForm action={deletePharmacyAction} className="mt-4 space-y-3 border-t border-line pt-4">
                  <input type="hidden" name="tenantId" value={t.id} />
                  <p className="text-xs text-muted">Permanently deletes every record and file of this pharmacy, including the controlled-drug register. Make sure the owner downloaded their export. Type <strong className="text-fg">{t.name}</strong> to confirm.</p>
                  <Input name="confirm" placeholder={t.name} autoComplete="off" />
                  <Submit variant="danger" size="sm"><Trash2 className="h-4 w-4" />Delete pharmacy permanently</Submit>
                </ActionForm>
              )}
            </Panel>
          )}
        </div>
      </section>
    </>
  );
}
