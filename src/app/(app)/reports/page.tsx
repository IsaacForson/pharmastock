import { ArrowUpRight, BarChart3, BookOpenCheck, ChartColumn, Download, Lock } from "lucide-react";
import Link from "next/link";
import { IconTile, PageHeader, Section } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { groupMeta } from "./icons";
import { REPORTS, type Report } from "./queries";
import { allowed } from "./run";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireCtx("reports.view");
  const groups = new Map<string, [string, Report][]>();
  for (const [name, r] of Object.entries(REPORTS) as [string, Report][]) {
    if (allowed(ctx, r)) groups.set(r.group, [...(groups.get(r.group) ?? []), [name, r]]);
  }
  const count = [...groups.values()].reduce((s, l) => s + l.length, 0);
  return (
    <>
      <PageHeader icon={<BarChart3 />} eyebrow="Insights" title="Reports"
        subtitle={`${count} reports across ${groups.size} areas · pick one, choose dates and branch, download as CSV.`} />
      <div className="space-y-10">
        {[...groups].map(([group, list]) => {
          const m = groupMeta(group);
          return (
            <Section key={group} title={<span className="inline-flex items-center gap-2">{group}<span className="rounded-md bg-surface-3 px-1.5 text-[10px] tabular-nums text-subtle">{list.length}</span></span>}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {list.map(([name, r]) => <ReportCard key={name} href={`/reports/${name}`} icon={m.icon} tone={m.tone} title={r.title} description={r.description}
                  tags={[r.chart && "Chart", "CSV", r.snapshot && "Right now", r.customerData && "Customer data · audited"]} />)}
                {group === "Finance" && (
                  <ReportCard href="/reports/accounting" icon={<BookOpenCheck />} tone="yellow" title="Accounting export"
                    description="Journal for your accountant plus sales, payments, purchases and expenses as CSV files ready to import." tags={["CSV"]} />
                )}
              </div>
            </Section>
          );
        })}
      </div>
    </>
  );
}

function ReportCard({ href, icon, tone, title, description, tags }: { href: string; icon: React.ReactNode; tone: "purple" | "teal" | "blue" | "green" | "yellow" | "red"; title: string; description: string; tags: (string | false | undefined)[] }) {
  return (
    <Link href={href} className="glass group relative flex flex-col overflow-hidden p-5 animate-rise transition hover:-translate-y-0.5 hover:border-line-strong">
      <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-aurora opacity-0 blur-3xl transition duration-500 group-hover:opacity-20" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <IconTile tone={tone}>{icon}</IconTile>
        <ArrowUpRight className="h-4 w-4 text-subtle transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{description}</p>
      <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] text-subtle">
        {tags.filter(Boolean).map((tag) => (
          <span key={tag as string} className={tag === "Customer data · audited" ? "inline-flex items-center gap-1 rounded-md bg-warn/12 px-1.5 py-0.5 text-warn" : "inline-flex items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5"}>
            {tag === "Chart" ? <ChartColumn className="h-3 w-3" aria-hidden /> : tag === "CSV" ? <Download className="h-3 w-3" aria-hidden /> : tag === "Customer data · audited" ? <Lock className="h-3 w-3" aria-hidden /> : null}{tag}
          </span>
        ))}
      </div>
    </Link>
  );
}
