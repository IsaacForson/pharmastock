/**
 * PharmaStock "Dispensary" component library. Screens compose these; they never hardcode palette colours.
 * Look: flat ruled sheets, small radii, ink on paper, one pharmacy green, monospaced figures. See DESIGN.md.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- Buttons ----------
const btn = {
  primary: "bg-brand border border-transparent hover:bg-accent-strong disabled:opacity-40",
  secondary: "bg-surface text-fg border border-line-strong hover:bg-surface-2 hover:border-fg/30",
  danger: "bg-surface text-bad border border-bad/45 hover:bg-bad/8",
  ghost: "text-muted border border-transparent hover:text-fg hover:bg-surface-2",
};
const sizes = { sm: "h-8 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2" };
const btnBase = "inline-flex items-center justify-center rounded font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed select-none";
export type BtnVariant = keyof typeof btn;
type BtnProps = { variant?: BtnVariant; size?: keyof typeof sizes };

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & BtnProps) {
  return <button className={cx(btnBase, sizes[size], btn[variant], className)} {...p} />;
}
export function LinkButton({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & BtnProps) {
  return <Link className={cx(btnBase, sizes[size], btn[variant], className)} {...p} />;
}
export function IconButton({ label, className, ...p }: ComponentProps<"button"> & { label: string }) {
  return <button aria-label={label} title={label} className={cx("grid h-9 w-9 place-items-center rounded border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-fg", className)} {...p} />;
}

// ---------- Form controls ----------
const control = "block w-full rounded border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle outline-none transition-colors hover:border-fg/35 focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2 disabled:opacity-60";
export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={cx(control, "h-9", className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => <textarea rows={3} className={cx(control, "py-2 leading-relaxed", className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<"select">) => <select className={cx(control, "h-9 appearance-none bg-[length:14px] bg-[right_10px_center] bg-no-repeat pr-8", "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%237b877f%22 stroke-width=%222.2%22><path d=%22m6 9 6 6 6-6%22/></svg>')]", className)} {...p} />;

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cx("block space-y-1", className)}>
      <span className="text-[12px] font-semibold text-fg">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] leading-snug text-subtle">{hint}</span>}
    </label>
  );
}

export function Check({ label, className, ...p }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm text-fg", className)}>
      <input type="checkbox" className="h-4 w-4 rounded-sm border-line-strong accent-[var(--accent)]" {...p} />
      {label}
    </label>
  );
}

// ---------- Surfaces ----------
/** Ruled sheet with an optional title bar. `glow` marks the sheet that holds the main action with a brand edge. */
export function Panel({ title, eyebrow, icon, actions, children, className, bodyClassName, glow }: {
  title?: ReactNode; eyebrow?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; glow?: boolean;
}) {
  return (
    <section className={cx("sheet overflow-hidden", glow && "border-t-[3px] border-t-accent", className)}>
      {(title || actions || eyebrow) && (
        <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line bg-surface-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {icon && <span className="shrink-0 text-accent [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>}
            {title && <h2 className="truncate text-[13px] font-semibold text-fg">{title}</h2>}
            {eyebrow && <span className="truncate font-mono text-[11px] text-subtle">{title ? "· " : ""}{eyebrow}</span>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
/** Back-compat alias used across screens. */
export const Card = Panel;

export function IconTile({ children, tone = "accent", className }: { children: ReactNode; tone?: Tone | "accent"; className?: string }) {
  const t = tone === "accent" ? "text-accent bg-accent/10" : TONE[tone].tile;
  return <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded [&>svg]:h-4 [&>svg]:w-4", t, className)} aria-hidden>{children}</span>;
}

/** Page title row: section label, title and subtitle on the left, actions on the right, ruled underneath. */
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-subtle">{eyebrow}</div>}
        <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.01em] text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line pb-1.5">
        <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Filter / action strip above lists. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mb-4 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

// ---------- Status ----------
const TONE = {
  gray: { soft: "border-line-strong text-muted bg-surface-2", dot: "bg-subtle", tile: "bg-surface-3 text-muted", edge: "border-l-line-strong" },
  green: { soft: "border-ok/40 text-ok bg-ok/8", dot: "bg-ok", tile: "bg-ok/10 text-ok", edge: "border-l-ok" },
  yellow: { soft: "border-warn/40 text-warn bg-warn/8", dot: "bg-warn", tile: "bg-warn/10 text-warn", edge: "border-l-warn" },
  red: { soft: "border-bad/40 text-bad bg-bad/8", dot: "bg-bad", tile: "bg-bad/10 text-bad", edge: "border-l-bad" },
  blue: { soft: "border-info/40 text-info bg-info/8", dot: "bg-info", tile: "bg-info/10 text-info", edge: "border-l-info" },
  teal: { soft: "border-accent-2/40 text-accent-2 bg-accent-2/8", dot: "bg-accent-2", tile: "bg-accent-2/10 text-accent-2", edge: "border-l-accent-2" },
  purple: { soft: "border-accent/40 text-accent bg-accent/8", dot: "bg-accent", tile: "bg-accent/10 text-accent", edge: "border-l-accent" },
} as const;
export type Tone = keyof typeof TONE;

/** Rectangular status tag: colour plus word, never colour alone. */
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode; pulse?: boolean }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-sm border px-1.5 py-[3px] text-[11px] font-semibold leading-none", TONE[tone].soft)}>{children}</span>;
}

export function StatusDot({ tone = "green", label }: { tone?: Tone; pulse?: boolean; label?: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} className={cx("inline-block h-2 w-2 rounded-[2px]", TONE[tone].dot)} />;
}

export function Callout({ tone = "purple", icon, children, actions }: { tone?: Tone; icon?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div role="status" className={cx("flex flex-wrap items-center gap-3 rounded border border-line border-l-4 bg-surface px-3.5 py-2.5 text-sm", TONE[tone].edge)}>
      {icon && <span className={cx("shrink-0 [&>svg]:h-4 [&>svg]:w-4", TONE[tone].tile.split(" ")[1])} aria-hidden>{icon}</span>}
      <div className="min-w-0 flex-1 text-fg">{children}</div>
      {actions}
    </div>
  );
}

// ---------- Data display ----------
export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="-mx-4 -my-4 overflow-x-auto">
      <table className="min-w-full text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            {head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr:hover]:bg-surface-2">{children}</tbody>
      </table>
      {rows.length === 0 && <EmptyState title={empty ?? "Nothing here yet"} compact />}
    </div>
  );
}
export const Td = ({ className, ...p }: ComponentProps<"td">) => <td className={cx("whitespace-nowrap px-4 py-2.5 text-fg", className)} {...p} />;

/** Figure tile: tone shown as a coloured leading rule; the number is set in mono like a ledger total. */
export function Kpi({ label, value, sub, icon, trend, delta, tone = "purple", href }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; trend?: number[]; delta?: { value: string; good: boolean }; tone?: Tone; href?: string;
}) {
  const body = (
    <div className={cx("sheet h-full border-l-4 px-4 py-3 transition-colors", TONE[tone].edge, href && "hover:bg-surface-2")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">{label}</span>
        {icon && <span className="text-subtle [&>svg]:h-4 [&>svg]:w-4" aria-hidden>{icon}</span>}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="font-mono text-[24px] font-semibold leading-none tracking-tight text-fg tabular-nums">{value}</div>
        {trend && trend.length > 1 && <Sparkline values={trend} className="h-7 w-20" />}
      </div>
      {(delta || sub) && (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-muted">
          {delta && <span className={cx("font-mono font-semibold", delta.good ? "text-ok" : "text-bad")}>{delta.value}</span>}
          {sub}
        </div>
      )}
    </div>
  );
  return href ? <Link href={href} className="block h-full rounded-md">{body}</Link> : body;
}
/** Back-compat: simple stat tile. */
export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => <Kpi label={label} value={value} sub={sub} />;

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / (max - min || 1)) * 28 - 1}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="miter" />
    </svg>
  );
}

/** Vertical bar chart (inline SVG-free divs, no library). */
export function BarChart({ data, format, height = 160 }: { data: { label: string; value: number }[]; format?: (v: number) => string; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1 border-b border-line-strong" style={{ height }} role="img" aria-label={data.map((d) => `${d.label}: ${format ? format(d.value) : d.value}`).join(", ")}>
      {data.map((d, i) => (
        <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
          <div className="relative w-full flex-1">
            <div className="absolute inset-x-[12%] bottom-0 bg-accent transition-colors group-hover:bg-accent-strong" style={{ height: `${Math.max((d.value / max) * 100, d.value ? 2 : 0)}%` }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-sm border border-line bg-solid px-1.5 py-0.5 font-mono text-[10px] text-fg shadow-lift group-hover:block">{format ? format(d.value) : d.value}</span>
          </div>
          <span className="pb-1 font-mono text-[10px] text-subtle">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Progress({ value, tone = "purple", className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cx("h-2 overflow-hidden rounded-sm bg-surface-3", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full", TONE[tone].dot)} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

/** Initials block (square, quiet): who did it, not decoration. */
export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name.replace(/^(dr|prof|mr|mrs|ms|pharm)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  const s = { sm: "h-6 w-6 text-[10px]", md: "h-8 w-8 text-[11px]", lg: "h-12 w-12 text-base" }[size];
  return <span className={cx("grid shrink-0 place-items-center rounded border border-line bg-surface-3 font-mono font-semibold text-fg", s, className)} aria-hidden>{initials}</span>;
}

export function ListRow({ title, meta, leading, trailing, href }: { title: ReactNode; meta?: ReactNode; leading?: ReactNode; trailing?: ReactNode; href?: string }) {
  const inner = (
    <div className="flex items-center gap-3 px-1 py-2 transition-colors hover:bg-surface-2">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{title}</div>
        {meta && <div className="truncate text-xs text-muted">{meta}</div>}
      </div>
      {trailing}
    </div>
  );
  return href ? <Link href={href} className="block border-b border-line last:border-b-0">{inner}</Link> : <div className="border-b border-line last:border-b-0">{inner}</div>;
}

export function EmptyState({ title, children, icon, compact }: { title: ReactNode; children?: ReactNode; icon?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center text-center", compact ? "gap-1.5 py-8" : "gap-2 rounded-md border border-dashed border-line-strong bg-surface px-6 py-12")}>
      {icon && <span className="text-subtle [&>svg]:h-5 [&>svg]:w-5" aria-hidden>{icon}</span>}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}
/** Back-compat alias. */
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => <EmptyState title={title}>{children}</EmptyState>;

/** Underlined tab strip made of links (sub-navigation and filters). */
export function Tabs({ tabs, current }: { tabs: { href: string; label: ReactNode; key: string; count?: number }[]; current: string }) {
  return (
    <nav className="mb-5 flex max-w-full gap-5 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}
          className={cx("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 py-2 text-[13px] font-medium transition-colors", t.key === current ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
          {t.label}
          {t.count !== undefined && <span className="font-mono text-[11px] text-subtle">({t.count})</span>}
        </Link>
      ))}
    </nav>
  );
}
export const Segmented = Tabs;

export function Dl({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx("grid gap-x-8 gap-y-3 text-sm", cols === 1 ? "grid-cols-1" : cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 border-b border-dotted border-line pb-2">
          <dt className="text-[12px] text-muted">{k}</dt>
          <dd className="mt-0.5 truncate font-medium text-fg">{v || <span className="text-subtle">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm border border-line-strong border-b-2 bg-surface px-1.5 py-px font-mono text-[10px] text-muted">{children}</kbd>;
}

export function Timeline({ items }: { items: { id: string; title: ReactNode; meta?: ReactNode; body?: ReactNode; tone?: Tone; href?: string }[] }) {
  return (
    <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[4px] before:w-px before:bg-line-strong">
      {items.map((i) => (
        <li key={i.id} className="relative pl-6">
          <span className={cx("absolute left-0 top-1.5 h-[9px] w-[9px] rounded-[1px]", TONE[i.tone ?? "purple"].dot)} aria-hidden />
          {i.href ? <Link href={i.href} className="text-sm font-medium text-fg hover:text-accent hover:underline">{i.title}</Link> : <div className="text-sm font-medium text-fg">{i.title}</div>}
          {i.meta && <div className="font-mono text-[11px] text-subtle">{i.meta}</div>}
          {i.body && <div className="mt-1 text-sm text-muted">{i.body}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Inline text link in the brand colour. */
export const A = ({ className, ...p }: ComponentProps<typeof Link>) => <Link className={cx("font-medium text-accent underline decoration-accent/30 underline-offset-[3px] hover:decoration-accent", className)} {...p} />;
