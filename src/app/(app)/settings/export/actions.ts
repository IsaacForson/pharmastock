"use server";
import { and, gt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { exportJobs } from "@/db/schema";
import { run, UserError, type ActionState } from "@/lib/action";
import { audit, AuthError, getCtx, tx } from "@/lib/auth";
import { enqueue } from "@/lib/jobs";
import { can } from "@/lib/permissions";

/** Deliberately not requireWrite: read-only (unpaid) accounts can always export their data. */
export async function requestExportAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await getCtx();
    if (!ctx) throw new AuthError("Your session has expired. Please sign in again.");
    if (!can(ctx.user.role, "export")) throw new AuthError("You don't have permission to do that.");
    await tx(ctx, async (t) => {
      const [busy] = await t.select({ id: exportJobs.id }).from(exportJobs)
        .where(and(inArray(exportJobs.status, ["pending", "running"]), gt(exportJobs.createdAt, new Date(Date.now() - 6 * 3600_000)))).limit(1);
      if (busy) throw new UserError("An export is already being prepared. It will appear below when ready.");
      const [job] = await t.insert(exportJobs).values({ tenantId: ctx.tenant.id, requestedBy: ctx.user.id, kind: "full" }).returning({ id: exportJobs.id });
      await enqueue(t, ctx.tenant.id, "export.run", { exportJobId: job.id });
      await audit(t, ctx, "request", "export_job", job.id);
    });
    revalidatePath("/settings/export");
    return { ok: true, message: "Export started. It usually takes a few minutes — refresh this page to download it." };
  });
}
