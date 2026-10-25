import { asc } from "drizzle-orm";
import { BadgeCheck, Clock, MapPin, Pencil, Phone, Plus, Sparkles } from "lucide-react";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { A, Badge, Check, Field, Input, Panel, Progress } from "@/components/ui";
import { branches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { billableBranches, CHAIN_MIN_BRANCHES, hasFeature, PLANS } from "@/lib/plans";
import { limitsFor } from "../limits";
import { describeHours, toMinutes, WEEKDAYS, type OpeningHours } from "@/lib/hours";
import { makeMainBranchAction, saveBranchAction, saveOpeningHoursAction } from "../actions";

export const metadata = { title: "Branches" };
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon → Sun
const SPAN: [number, number] = [6 * 60, 22 * 60]; // visual window 06:00–22:00

/** Seven tracks showing open hours across the day. */
function WeekHours({ hours }: { hours: OpeningHours }) {
  const pos = (m: number) => `${((Math.min(Math.max(m, SPAN[0]), SPAN[1]) - SPAN[0]) / (SPAN[1] - SPAN[0])) * 100}%`;
  return (
    <div className="space-y-1.5" role="img" aria-label={ORDER.map((i) => `${WEEKDAYS[i]} ${describeHours(hours[String(i) as keyof OpeningHours])}`).join(", ")}>
      {ORDER.map((i) => {
        const h = hours[String(i) as keyof OpeningHours];
        return (
          <div key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-xs">
            <span className="font-medium text-muted">{WEEKDAYS[i].slice(0, 3)}</span>
            <span className="relative h-2 rounded-full bg-surface-3">
              {h && <span className="absolute inset-y-0 rounded-full bg-brand" style={{ left: pos(toMinutes(h[0])), right: `calc(100% - ${pos(toMinutes(h[1]))})` }} />}
            </span>
            <span className={h ? "text-right tabular-nums text-fg" : "text-right text-subtle"}>{h ? `${h[0]}–${h[1]}` : "Closed"}</span>
          </div>
        );
      })}
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_5.5rem] gap-3 text-[10px] text-subtle" aria-hidden>
        <span /><span className="flex justify-between tabular-nums"><span>06</span><span>12</span><span>18</span><span>22</span></span><span />
      </div>
    </div>
  );
}

export default async function BranchesPage() {
  const ctx = await requireCtx("settings.manage");
  const rows = await tx(ctx, (t) => t.select().from(branches).orderBy(asc(branches.name)));
  const limit = limitsFor(ctx.tenant).branches;
  const plan = ctx.tenant.plan;
  const activeCount = rows.filter((b) => b.active).length;
  const canAdd = hasFeature(ctx.tenant, "multi_branch") && activeCount < limit;
  const summary = "flex cursor-pointer list-none items-center gap-2 rounded px-3 py-2.5 text-sm font-medium text-fg transition hover:bg-surface-2 [&::-webkit-details-marker]:hidden";
  return (
    <>
      <div className="sheet flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-mono uppercase tracking-wider text-subtle">Active branches</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">{activeCount} <span className="text-base font-normal text-muted">of {limit} on {ctx.tenant.planStatus === "trialing" ? "your trial" : PLANS[plan].name}</span></div>
          {plan === "chain" && <p className="mt-1 text-xs text-subtle">Chain is billed per branch, at least {CHAIN_MIN_BRANCHES}: you are billed for {billableBranches(plan, activeCount)} branches.</p>}
        </div>
        <Progress value={(activeCount / limit) * 100} className="w-full sm:w-56" />
      </div>

      <div className="grid gap-6 2xl:grid-cols-2">
        {rows.map((b) => (
          <Panel key={b.id} icon={<MapPin />} eyebrow={b.isMain ? "Main branch" : "Branch"} title={b.name}
            className={b.active ? "" : "opacity-70"}
            actions={<>
              {!b.active && <Badge>Inactive</Badge>}
              {b.isMain ? <Badge tone="teal">Main</Badge> : b.active && <ActionButton action={makeMainBranchAction} fields={{ id: b.id }}>Make main</ActionButton>}
            </>}>
            <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-subtle" aria-hidden />{b.address || "No address"}</span>
              <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-subtle" aria-hidden />{b.phone || "No phone"}</span>
              <span className="inline-flex items-center gap-1.5"><BadgeCheck className="h-3.5 w-3.5 text-subtle" aria-hidden />{b.licenceNo ? <span className="font-mono">{b.licenceNo}</span> : "No licence number"}</span>
            </div>
            <WeekHours hours={b.openingHours} />

            <div className="mt-5 space-y-1 border-t border-line pt-3">
              <details className="group/d rounded">
                <summary className={summary}><Pencil className="h-4 w-4 text-accent" aria-hidden /> Edit details</summary>
                <ActionForm action={saveBranchAction} className="grid items-end gap-4 px-3 pb-3 pt-2 [&>*]:mb-0! sm:grid-cols-2">
                  <input type="hidden" name="id" value={b.id} />
                  <Field label="Name"><Input name="name" defaultValue={b.name} required /></Field>
                  <Field label="Phone"><Input name="phone" defaultValue={b.phone ?? ""} /></Field>
                  <Field label="Address"><Input name="address" defaultValue={b.address ?? ""} /></Field>
                  <Field label="Premises licence no." hint="If this branch has its own licence"><Input name="licenceNo" defaultValue={b.licenceNo ?? ""} className="font-mono" /></Field>
                  <Check name="active" defaultChecked={b.active} label="Active" className="h-10" />
                  <div className="flex justify-end"><Submit variant="secondary">Save details</Submit></div>
                </ActionForm>
              </details>
              <details className="rounded">
                <summary className={summary}><Clock className="h-4 w-4 text-accent" aria-hidden /> Edit opening hours</summary>
                <ActionForm action={saveOpeningHoursAction} className="space-y-2 px-3 pb-3 pt-2">
                  <input type="hidden" name="id" value={b.id} />
                  <p className="text-xs text-subtle">Your trading hours for this branch, for staff and reports.</p>
                  {ORDER.map((i) => {
                    const d = WEEKDAYS[i];
                    const h = b.openingHours[String(i) as keyof typeof b.openingHours];
                    return (
                      <div key={d} className="grid grid-cols-[3rem_1fr_1fr_auto] items-center gap-2 text-sm">
                        <span className="font-medium text-muted">{d.slice(0, 3)}</span>
                        <Input type="time" name={`open_${i}`} defaultValue={h?.[0] ?? "08:00"} aria-label={`${d} opens`} />
                        <Input type="time" name={`close_${i}`} defaultValue={h?.[1] ?? "17:00"} aria-label={`${d} closes`} />
                        <Check name={`closed_${i}`} defaultChecked={!h} label={<span className="text-xs text-muted">Closed</span>} />
                      </div>
                    );
                  })}
                  <div className="flex justify-end pt-1"><Submit variant="secondary">Save opening hours</Submit></div>
                </ActionForm>
              </details>
            </div>
          </Panel>
        ))}
      </div>

      <Panel title="Add a branch" eyebrow="Grow" icon={canAdd ? <Plus /> : <Sparkles />}>
        {canAdd ? (
          <ActionForm action={saveBranchAction} resetOnSuccess className="grid items-end gap-4 [&>*]:mb-0! sm:grid-cols-[2fr_2fr_1fr_1fr_auto]">
            <input type="hidden" name="active" value="on" />
            <Field label="Name"><Input name="name" required placeholder="e.g. East Legon" /></Field>
            <Field label="Address"><Input name="address" /></Field>
            <Field label="Phone"><Input name="phone" /></Field>
            <Field label="Licence no."><Input name="licenceNo" className="font-mono" /></Field>
            <Submit>Add branch</Submit>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Your plan includes {limit} branch{limit === 1 ? "" : "es"}. Multiple branches with transfers, central purchasing and consolidated reports are on the <A href="/settings/subscription">Chain plan</A>, billed per branch (minimum {CHAIN_MIN_BRANCHES}).</p>
        )}
      </Panel>
    </>
  );
}
