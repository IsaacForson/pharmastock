import { CalendarRange } from "lucide-react";
import Link from "next/link";
import { cx, Input } from "@/components/ui";
import { PRESETS, type Range } from "./range";

/** Single-series bar chart as inline SVG (no chart library). Hover a bar for its value; pair with a table for exact numbers. */
export function BarChart({ data, format, label, height = 160 }: {
  data: { label: string; value: number }[]; format: (v: number) => string; label: string; height?: number;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const w = 100 / Math.max(data.length, 1);
  const tickEvery = Math.ceil(data.length / 8);
  const short = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : s);
  return (
    <figure className="w-full">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}. Highest ${format(max)}.`} className="h-44 w-full overflow-visible">
        <defs>
          <linearGradient id="rbar" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent-2)" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0.55" /></linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2="100" y1={height * g} y2={height * g} stroke="var(--line)" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="var(--line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = max ? (d.value / max) * (height - 4) : 0;
          return (
            <g key={d.label} className="group">
              {/* Full-height hit target so tiny bars are still hoverable. */}
              <rect x={i * w} y={0} width={w} height={height} className="fill-transparent group-hover:fill-surface-2" />
              <rect x={i * w + w * 0.15} y={height - Math.max(h, d.value ? 1 : 0)} width={w * 0.7} height={Math.max(h, d.value ? 1 : 0)} rx="0.6" fill="url(#rbar)" className="transition group-hover:brightness-125" />
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex text-[10px] text-subtle tabular-nums" aria-hidden>
        {data.map((d, i) => <span key={d.label} className="truncate text-center" style={{ width: `${w}%` }}>{i % tickEvery === 0 ? short(d.label) : ""}</span>)}
      </div>
    </figure>
  );
}

/** Preset segmented control + custom from/to form; works without JavaScript. */
export function RangePicker({ range, path, extra = {} }: { range: Range; path: string; extra?: Record<string, string> }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 print:hidden">
      <nav aria-label="Date range presets" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-line bg-surface p-1">
        {Object.entries(PRESETS).map(([k, label]) => (
          <Link key={k} href={`${path}?${new URLSearchParams({ ...extra, preset: k })}`} aria-current={range.preset === k ? "true" : undefined}
            className={cx("whitespace-nowrap rounded px-3.5 py-1.5 text-sm font-medium transition", range.preset === k ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg")}>
            {label}
          </Link>
        ))}
      </nav>
      <form className={cx("flex flex-wrap items-center gap-2 rounded-md border bg-surface p-1 pl-3", range.preset === "custom" ? "border-accent/40" : "border-line")} action={path}>
        {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <CalendarRange className="h-4 w-4 text-subtle" aria-hidden />
        <Input type="date" name="from" defaultValue={range.from} aria-label="From" className="h-9 w-auto" />
        <span className="text-xs text-subtle">to</span>
        <Input type="date" name="to" defaultValue={range.to} aria-label="To" className="h-9 w-auto" />
        <button className="h-9 rounded border border-line bg-surface-2 px-3 text-sm font-medium text-fg transition hover:bg-surface-3">Apply</button>
      </form>
    </div>
  );
}

export const rangeQuery = (r: Range) => (r.preset === "custom" ? `from=${r.from}&to=${r.to}` : `preset=${r.preset}`);

/** Branch filter for owners/managers on Chain ("All branches" = consolidated) or users allowed into several branches. */
export function BranchPicker({ branches, scope, path, keep }: { branches: { id: string; name: string }[]; scope: { ids: string[]; all: boolean; canAll: boolean }; path: string; keep: Record<string, string> }) {
  if (branches.length < 2) return null;
  const href = (b: string) => `${path}?${new URLSearchParams({ ...keep, branch: b })}`;
  const opts = [...(scope.canAll ? [{ id: "all", name: "All branches" }] : []), ...branches];
  const current = scope.all ? "all" : scope.ids[0];
  return (
    <nav aria-label="Branch" className="mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-line bg-surface p-1 print:hidden">
      {opts.map((b) => (
        <Link key={b.id} href={href(b.id)} aria-current={current === b.id ? "true" : undefined}
          className={cx("whitespace-nowrap rounded px-3.5 py-1.5 text-sm font-medium transition", current === b.id ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg")}>
          {b.name}
        </Link>
      ))}
    </nav>
  );
}
