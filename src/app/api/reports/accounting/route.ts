import { DOCS, type DocName } from "@/app/(app)/reports/accounting/data";
import { resolveRange } from "@/app/(app)/reports/range";
import { reportScope } from "@/app/(app)/reports/scope";
import { audit, getCtx, tx } from "@/lib/auth";
import { can } from "@/lib/permissions";

/** Accounting CSVs (?doc=journal|sales|sale-lines|payments|purchases|supplier-payments|expenses). Audited; allowed on read-only accounts. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  if (!can(ctx.user.role, "export")) return new Response("Forbidden", { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const doc = sp.doc as DocName;
  if (!Object.hasOwn(DOCS, doc)) return new Response("Unknown document", { status: 404 });
  const range = resolveRange(sp, ctx.tenant.timezone, new Date(), "lastMonth");
  const scope = reportScope(ctx, sp.branch);
  const csv = await tx(ctx, async (t) => {
    const out = await DOCS[doc].csv(t, { range, branches: scope.ids, all: scope.all || ctx.branches.length === 1, tz: ctx.tenant.timezone });
    await audit(t, ctx, "export", "accounting", doc, { details: { from: range.from, to: range.to, branches: scope.all ? "all" : scope.ids } });
    return out;
  });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.tenant.slug}-${doc}-${range.from}_${range.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
