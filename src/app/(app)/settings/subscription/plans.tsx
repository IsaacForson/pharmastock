"use client";
import { Check } from "lucide-react";
import { useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { Badge, cx } from "@/components/ui";

export type PlanCard = {
  key: string; name: string; monthlyLabel: string; annualLabel: string; annualPerMonthLabel: string; unitNote: string | null;
  limits: string; lead: string | null; features: string[]; current: boolean; recommended: boolean; cta: string;
};
type Action = Parameters<typeof ActionForm>[0]["action"];

/** Plan cards with a single monthly/annual switch driving every card's price and submitted cycle. */
export function PlanGrid({ plans, action, initialCycle }: { plans: PlanCard[]; action: Action; initialCycle: "monthly" | "annual" }) {
  const [cycle, setCycle] = useState(initialCycle);
  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Billing cycle" className="inline-flex gap-1 rounded-2xl border border-line bg-surface p-1">
          {(["monthly", "annual"] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => setCycle(c)}
              className={cx("inline-flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-medium capitalize transition", cycle === c ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg")}>
              {c}{c === "annual" && <span className="rounded-md bg-ok/12 px-1.5 py-0.5 text-[10px] font-semibold text-ok">2 months free</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((p) => (
          <div key={p.key} className={cx("glass relative flex flex-col overflow-hidden p-6 animate-rise transition hover:-translate-y-0.5", p.recommended && "ring-aurora shadow-glow lg:-my-2 lg:py-8")}>
            {p.recommended && <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-aurora opacity-25 blur-3xl" aria-hidden />}
            <div className="relative flex items-center justify-between gap-2">
              <h3 className={cx("text-lg font-semibold tracking-tight", p.recommended ? "text-aurora" : "text-fg")}>{p.name}</h3>
              <div className="flex gap-1.5">
                {p.recommended && <Badge tone="purple">Most popular</Badge>}
                {p.current && <Badge tone="teal">Current</Badge>}
              </div>
            </div>
            <div className="relative mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-semibold tracking-[-0.03em] text-fg tabular-nums">{cycle === "annual" ? p.annualLabel : p.monthlyLabel}</span>
              <span className="text-sm text-muted">/{cycle === "annual" ? "year" : "month"}</span>
            </div>
            <p className="relative mt-1 text-xs text-subtle">{cycle === "annual" ? `≈ ${p.annualPerMonthLabel}/month, billed yearly` : `or ${p.annualLabel}/year — 2 months free`}</p>
            {p.unitNote && <p className="relative mt-1 text-xs text-muted">{p.unitNote}</p>}

            <p className="relative mt-5 text-sm font-medium text-fg">{p.limits}</p>
            {p.lead && <p className="relative mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-subtle">{p.lead}</p>}
            <ul className="relative mb-6 mt-3 space-y-2.5 text-sm text-muted">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent/15 text-accent" aria-hidden><Check className="h-3 w-3" /></span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <ActionForm action={action} className="relative mt-auto space-y-3">
              <input type="hidden" name="plan" value={p.key} />
              <input type="hidden" name="cycle" value={cycle} />
              <Submit variant={p.recommended ? "primary" : "secondary"} size="lg" className="w-full">{p.cta}</Submit>
            </ActionForm>
          </div>
        ))}
      </div>
    </div>
  );
}
