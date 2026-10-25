import { loadReport } from "@/app/(app)/reports/run";
import { toCsv } from "@/app/(app)/reports/range";
import { getCtx } from "@/lib/auth";
import { toMajor } from "@/lib/format";

/** CSV export of any report. Read-only accounts can still export (data is never locked). Every download is audited. */
export async function GET(req: Request, { params }: RouteContext<"/api/reports/[name]">) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { name } = await params;
  const loaded = await loadReport(ctx, name, Object.fromEntries(new URL(req.url).searchParams), "export");
  if (!loaded) return new Response("Not found", { status: 404 });
  const { report, range, rows, scope } = loaded;
  const csv = toCsv(
    report.cols.map((c) => (c.kind === "money" ? `${c.label} (${ctx.tenant.currency})` : c.kind === "pct" ? `${c.label} (%)` : c.label)),
    rows.map((r) => report.cols.map((c) => (c.kind === "money" && r[c.key] !== null && r[c.key] !== undefined ? toMajor(Number(r[c.key])) : r[c.key]))),
  );
  const when = report.snapshot ? new Date().toISOString().slice(0, 10) : `${range.from}_${range.to}`;
  const where = scope.all ? "all-branches" : ctx.branches.length > 1 ? (ctx.branches.find((b) => b.id === scope.ids[0])?.name ?? "branch").toLowerCase().replace(/[^a-z0-9]+/g, "-") : "";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${[ctx.tenant.slug, name, where, when].filter(Boolean).join("-")}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
