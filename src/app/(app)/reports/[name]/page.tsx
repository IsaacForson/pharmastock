import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarX, ChartColumn, Download, Hash, Lock, Rows3, Table2, Wallet } from "lucide-react";
import { Callout, cx, EmptyState, Kpi, LinkButton, PageHeader, Panel, Table, Td } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { dateOnly, money } from "@/lib/format";
import { groupMeta } from "../icons";
import { getReport, type Cell, type Col } from "../queries";
import { rangeQuery } from "../ui";
import { keepParams, loadReport } from "../run";
import { BarChart, BranchPicker, RangePicker } from "../ui";

export async function generateMetadata({ params }: PageProps<"/reports/[name]">) {
  return { title: getReport((await params).name)?.title ?? "Report" };
}

export default async function ReportPage({ params, searchParams }: PageProps<"/reports/[name]">) {
  const { name } = await params;
  const ctx = await requireCtx("reports.view");
  const loaded = await loadReport(ctx, name, await searchParams, "view");
  if (!loaded) notFound();
  const { report, range, scope, days, rows } = loaded;
  const cur = ctx.tenant.currency;
  const fmt = (c: Col, v: Cell) => {
    if (v === null || v === "") return <span className="text-subtle">—</span>;
    if (c.kind === "money") return money(Number(v), cur);
    if (c.kind === "pct") return `${v}%`;
    if (c.kind === "int") return Number(v).toLocaleString("en");
    if (c.kind === "num") return Number(v).toLocaleString("en", { maximumFractionDigits: 2 });
    return String(v);
  };
  const chartCol = report.chart ? report.cols.find((c) => c.key === report.chart) : undefined;
  const xKey = report.cols[0].key;
  const totals = report.cols.map((c, i) => i > 0 && !report.noTotals && (c.kind === "money" || c.kind === "int") ? rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0) : null);
  const tz = ctx.tenant.timezone;
  const m = groupMeta(report.group);
  const kpis = report.cols.map((c, i) => ({ c, total: totals[i] })).filter((k) => k.total !== null && rows.length > 0).slice(0, 3);
  const keep = keepParams(scope, days, report);
  const path = `/reports/${name}`;
  const csvHref = `/api/reports/${name}?${new URLSearchParams({ ...keep, ...Object.fromEntries(new URLSearchParams(rangeQuery(range))) })}`;
  const branchLabel = scope.all ? "All branches" : ctx.branches.find((b) => b.id === scope.ids[0])?.name;
  return (
    <>
      <PageHeader icon={m.icon} eyebrow={<Link href="/reports" className="hover:underline underline-offset-4">Reports · {report.group}</Link>} title={report.title}
        subtitle={<>{report.description} <span className="whitespace-nowrap font-medium text-fg">{report.snapshot ? "As of now" : `${dateOnly(range.start, tz)} – ${dateOnly(new Date(range.end.getTime() - 1), tz)}`}{ctx.branches.length > 1 ? ` · ${branchLabel}` : ""}</span></>}
        actions={<>
          <LinkButton href="/reports" variant="ghost"><ArrowLeft className="h-4 w-4" aria-hidden />All reports</LinkButton>
          <a href={csvHref} download className="inline-flex h-10 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-on-accent transitionhover:bg-accent-strong">
            <Download className="h-4 w-4" aria-hidden />Download CSV
          </a>
        </>} />
      <BranchPicker branches={ctx.branches} scope={scope} path={path} keep={{ ...(report.snapshot ? {} : Object.fromEntries(new URLSearchParams(rangeQuery(range)))), ...(report.days ? { days: String(days) } : {}) }} />
      {!report.snapshot && <RangePicker range={range} path={path} extra={keep} />}
      {report.days && (
        <nav aria-label={report.days.label} className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
          <span className="text-xs text-subtle">{report.days.label}</span>
          {report.days.values.map((d) => (
            <Link key={d} href={`${path}?${new URLSearchParams({ ...keep, days: String(d) })}`} aria-current={d === days ? "true" : undefined}
              className={cx("rounded border px-3 py-1.5 text-sm font-medium transition", d === days ? "border-accent/40 bg-accent/15 text-fg" : "border-line text-muted hover:text-fg")}>{d} days</Link>
          ))}
        </nav>
      )}
      {report.customerData && <div className="mb-4"><Callout tone="yellow" icon={<Lock />}>Names customers. Viewing and downloading this report is recorded in the audit log.</Callout></div>}

      {kpis.length > 0 && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Rows" value={rows.length.toLocaleString("en")} icon={<Rows3 />} tone="gray" sub={report.snapshot ? "right now" : "in this period"} />
          {kpis.map(({ c, total }) => (
            <Kpi key={c.key} label={`Total ${c.label.toLowerCase()}`} value={fmt(c, total)} icon={c.kind === "money" ? <Wallet /> : <Hash />} tone={c.kind === "money" ? "green" : "purple"}
              trend={chartCol && rows.length > 2 && rows.length <= 400 ? rows.map((r) => Number(r[c.key] ?? 0)) : undefined} />
          ))}
        </div>
      )}

      {chartCol && rows.length > 0 && (
        <Panel className="mb-6" icon={<ChartColumn />} eyebrow="Trend" title={`${chartCol.label} by ${report.cols[0].label.toLowerCase()}`}>
          <BarChart label={`${chartCol.label} by ${report.cols[0].label.toLowerCase()}`} data={rows.map((r) => ({ label: String(r[xKey]), value: Number(r[chartCol.key] ?? 0) }))}
            format={(v) => (chartCol.kind === "money" ? money(v, cur) : chartCol.kind === "pct" ? `${v}%` : String(v))} />
        </Panel>
      )}

      <Panel icon={<Table2 />} eyebrow={`${rows.length.toLocaleString("en")} row${rows.length === 1 ? "" : "s"}`} title="Data">
        {rows.length === 0 ? (
          <EmptyState compact icon={<CalendarX />} title={report.snapshot ? "Nothing to show right now" : "No data for this period"}>
            {report.snapshot ? "This list fills up as stock is received and sold." : "Try a wider range such as “Last 90 days” or “Last 12 months”."}
          </EmptyState>
        ) : (
          <Table head={report.cols.map((c) => c.label)}>
            {rows.map((r, i) => (
              <tr key={i}>
                {report.cols.map((c) => <Td key={c.key} className={c.kind && c.kind !== "text" ? "text-right tabular-nums" : "max-w-xs truncate"}>{fmt(c, r[c.key] ?? null)}</Td>)}
              </tr>
            ))}
            {rows.length > 1 && totals.some((x) => x !== null) && (
              <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold">
                {report.cols.map((c, i) => <Td key={c.key} className={i ? "text-right tabular-nums" : ""}>{i === 0 ? "Total" : totals[i] === null ? "" : fmt(c, totals[i])}</Td>)}
              </tr>
            )}
          </Table>
        )}
      </Panel>
    </>
  );
}
