import "server-only";
import { audit, tx, type Ctx } from "@/lib/auth";
import { localDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { getReport, type Report } from "./queries";
import { resolveRange } from "./range";
import { reportScope } from "./scope";

type Sp = Record<string, string | string[] | undefined>;

/** Reports this user may open (permission + plan feature). */
export const allowed = (ctx: Ctx, r: Report) => can(ctx.user.role, "reports.view") && (!r.perm || can(ctx.user.role, r.perm)) && (!r.feature || hasFeature(ctx.tenant, r.feature));

/** Resolves range, branch scope and options, then runs the report in the tenant's RLS transaction. null = not found / not allowed. */
export async function loadReport(ctx: Ctx, name: string, sp: Sp, mode: "view" | "export") {
  const report = getReport(name);
  if (!report || !allowed(ctx, report)) return null;
  const range = resolveRange(sp, ctx.tenant.timezone, new Date(), report.defaultPreset);
  const scope = reportScope(ctx, sp.branch);
  const wantDays = Number(sp.days);
  const days = report.days ? (report.days.values.includes(wantDays) ? wantDays : report.days.default) : 0;
  const rows = await tx(ctx, async (t) => {
    const out = await report.run(t, { ctx, range, branches: scope.ids, today: localDay(ctx.tenant.timezone), days });
    if (mode === "export" || report.customerData) {
      await audit(t, ctx, mode, "report", name, { details: { from: range.from, to: range.to, branches: scope.all ? "all" : scope.ids, rows: out.length } });
    }
    return out;
  });
  return { report, range, scope, days, rows };
}

/** Query params that keep the current branch/options when switching range (and vice versa). */
export function keepParams(scope: { all: boolean; ids: string[] }, days: number, report: Report) {
  return { ...(scope.all ? { branch: "all" } : { branch: scope.ids[0] }), ...(report.days ? { days: String(days) } : {}) };
}
