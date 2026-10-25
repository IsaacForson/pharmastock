import type { Ctx } from "@/lib/auth";
import { branchScope } from "@/lib/analytics";
import { hasFeature } from "@/lib/plans";

/** Branches a report covers for this user and ?branch= (consolidated "all" for Chain owners/managers, which is their default). */
export const reportScope = (ctx: Ctx, wanted: string | string[] | undefined) =>
  branchScope({ role: ctx.user.role, consolidated: hasFeature(ctx.tenant, "consolidated"), branches: ctx.branches, current: ctx.branchId, wanted: typeof wanted === "string" ? wanted : null, defaultAll: true });
