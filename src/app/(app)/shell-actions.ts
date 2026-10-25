"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminDb } from "@/db";
import { auditLog, sessions } from "@/db/schema";
import { getCtx, setBranch } from "@/lib/auth";

export async function switchBranchAction(fd: FormData) {
  const ctx = await getCtx();
  const id = String(fd.get("branchId"));
  if (ctx?.branches.some((b) => b.id === id)) await setBranch(id);
  revalidatePath("/", "layout");
}

/** Ends a PharmaStock support (read-only) session and returns to Control. */
export async function endSupportViewAction() {
  const ctx = await getCtx();
  if (!ctx?.impersonatedBy) redirect("/dashboard");
  await adminDb().delete(sessions).where(eq(sessions.id, ctx.sessionId));
  await adminDb().insert(auditLog).values({ tenantId: ctx.tenant.id, userId: null, action: "support_view_end", entity: "tenant", entityId: ctx.tenant.id, details: { impersonatedBy: ctx.impersonatedBy } });
  (await cookies()).delete("ps_session");
  redirect(`/admin/pharmacies/${ctx.tenant.id}`);
}
