import { getCtx, audit, tx } from "@/lib/auth";
import { toCsv } from "@/lib/claims";
import { localDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { loadClaim } from "../data";

/** Claim batch as CSV for the payer's portal or email. */
export async function GET(_: Request, { params }: RouteContext<"/claims/[id]/csv">) {
  const ctx = await getCtx();
  if (!ctx || !can(ctx.user.role, "claims.manage")) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const d = await tx(ctx, async (t) => {
    const c = await loadClaim(t, id);
    if (c) await audit(t, ctx, "export", "claim", id, { details: { items: c.items.length } });
    return c;
  });
  if (!d) return new Response("Not found", { status: 404 });
  const tz = ctx.tenant.timezone;
  const csv = toCsv([
    ["Claim", "Payer", "Sale", "Date", "Customer", "Customer no", "Member no", "Sale total", "Amount claimed", "Amount paid", "Status", "Rejection reason"],
    ...d.items.map((r) => [d.c.batchNo, d.payer.name, r.saleNo, localDay(tz, r.soldAt), r.customer, r.customerNo, r.memberNo, (r.total / 100).toFixed(2), (r.i.amountClaimedMinor / 100).toFixed(2), (r.i.amountPaidMinor / 100).toFixed(2), r.i.status, r.i.rejectionReason]),
  ]);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${d.c.batchNo}.csv"`, "Cache-Control": "private, no-store" } });
}
