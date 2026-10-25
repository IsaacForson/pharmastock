import { AuthError, getCtx, tx } from "@/lib/auth";
import { UserError } from "@/lib/action";
import { can } from "@/lib/permissions";
import { createSale, recordRepayment } from "@/lib/sales";
import { OP_PERMISSION, syncBody, type OpResult } from "./ops";

/**
 * Replays the offline outbox in order. Each op runs in its own transaction so one refusal doesn't undo the rest.
 * Sales already happened at the counter: they are never refused for stock (shortfalls raise an alert) and are idempotent
 * on clientId, so a retried sync never sells twice.
 */
export async function POST(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const parsed = syncBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid sync request", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });

  const results: OpResult[] = [];
  let halted = false;
  for (const op of parsed.data.ops) {
    // Keep order: once something fails transiently, later ops wait for the next sync.
    if (halted) { results.push({ id: op.id, status: "retry" }); continue; }
    // Sales and payments must be attributed to whoever made them on a shared device.
    if (op.userId !== ctx.user.id) { results.push({ id: op.id, status: "retry", error: "Saved by another user; syncs when they sign in." }); continue; }
    if (!can(ctx.user.role, OP_PERMISSION[op.type])) { results.push({ id: op.id, status: "rejected", error: "You don't have permission to do that." }); continue; }
    if (ctx.access === "read_only") { results.push({ id: op.id, status: "rejected", error: "This account is read-only until the subscription is renewed." }); continue; }
    try {
      if (op.type === "sale") {
        const sale = await tx(ctx, (t) => createSale(t, ctx, op.input, { offline: true }));
        results.push({ id: op.id, status: "saved", saleId: sale.id, saleNo: sale.saleNo });
      } else {
        await tx(ctx, (t) => recordRepayment(t, ctx, { customerId: op.customerId, amountMinor: op.amountMinor, method: op.method, reference: op.reference ?? null, clientId: op.clientId }));
        results.push({ id: op.id, status: "saved" });
      }
    } catch (e) {
      if (e instanceof UserError || e instanceof AuthError) results.push({ id: op.id, status: "rejected", error: e.message });
      else { console.error("offline sync", e); halted = true; results.push({ id: op.id, status: "retry" }); }
    }
  }
  return Response.json({ results });
}
