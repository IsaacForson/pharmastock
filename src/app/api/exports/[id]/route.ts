import { eq } from "drizzle-orm";
import { exportJobs } from "@/db/schema";
import { audit, getCtx, tx } from "@/lib/auth";
import { getFile } from "@/lib/storage";

/** Owner-only download of a finished full export (works for read-only accounts too). */
export async function GET(_: Request, { params }: RouteContext<"/api/exports/[id]">) {
  const ctx = await getCtx();
  if (!ctx || ctx.user.role !== "owner" || ctx.impersonatedBy) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const job = await tx(ctx, async (t) => {
    const [j] = await t.select().from(exportJobs).where(eq(exportJobs.id, id));
    if (j?.storageKey) await audit(t, ctx, "download", "export_job", j.id);
    return j;
  });
  if (!job?.storageKey) return new Response("Not found", { status: 404 });
  const data = await getFile(ctx.tenant.id, job.storageKey);
  const name = `pharmastock-export-${job.createdAt.toISOString().slice(0, 10)}.zip`;
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"`, "Content-Length": String(data.length), "Cache-Control": "private, no-store" },
  });
}
