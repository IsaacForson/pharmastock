import { Building2, Filter } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, PageHeader, Progress, Select, Tabs, type Tone } from "@/components/ui";
import type { Ctx } from "@/lib/auth";
import { PERIODS, withQuery, type PeriodKey } from "./lib";

const SECTIONS = [
  { key: "overview", href: "/owner", label: "Overview" },
  { key: "team", href: "/owner/team", label: "Staff accountability" },
  { key: "activity", href: "/owner/activity", label: "Activity" },
] as const;

/** Header, section nav and (optionally) the period + branch filters shared by every console page. */
export function ConsoleHeader({ ctx, current, subtitle, period, branch }: {
  ctx: Ctx; current: (typeof SECTIONS)[number]["key"]; subtitle: ReactNode; period?: PeriodKey; branch?: string | null;
}) {
  const keep = { period: period && period !== "month" ? period : null, branch: branch ?? null };
  const here = SECTIONS.find((s) => s.key === current)!.href;
  return (
    <>
      <PageHeader icon={<Building2 />} eyebrow="Owner console" title={ctx.tenant.name} subtitle={subtitle} />
      <Tabs current={current} tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label, href: withQuery(s.href, s.key === "activity" ? {} : keep) }))} />
      {period && (
        <div className="-mt-2 mb-6 flex flex-wrap items-start justify-between gap-3">
          <Tabs current={period} tabs={(Object.keys(PERIODS) as PeriodKey[]).map((k) => ({ key: k, label: PERIODS[k], href: withQuery(here, keep, { period: k === "month" ? null : k }) }))} />
          {branch !== undefined && ctx.branches.length > 1 && (
            <form className="flex items-center gap-2" action={here}>
              {keep.period && <input type="hidden" name="period" value={keep.period} />}
              <label className="sr-only" htmlFor="branch">Branch</label>
              <Select id="branch" name="branch" defaultValue={branch ?? ""} className="w-52">
                <option value="">All branches</option>
                {ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <Button type="submit" variant="secondary"><Filter className="h-4 w-4" aria-hidden /> Apply</Button>
            </form>
          )}
        </div>
      )}
    </>
  );
}

/** Ranked list with share-of-total bars (payment mix, top products, branches). */
export function ShareList({ rows, format, tone = "purple", empty, meta }: {
  rows: { label: string; amount: number }[]; format: (v: number) => string; tone?: Tone; empty: string; meta?: (i: number) => ReactNode;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (!rows.length || !total) return <EmptyState title={empty} compact />;
  return (
    <ul className="space-y-3.5">
      {rows.map((r, i) => (
        <li key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium capitalize text-fg">{r.label}</span>
            <span className="shrink-0 tabular-nums text-fg">{format(r.amount)} <span className="text-xs text-subtle">{Math.round((r.amount / total) * 100)}%</span></span>
          </div>
          {meta && <div className="text-xs text-muted">{meta(i)}</div>}
          <Progress value={(r.amount / total) * 100} tone={tone} className="mt-1.5" />
        </li>
      ))}
    </ul>
  );
}
