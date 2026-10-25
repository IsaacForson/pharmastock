import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { alerts } from "@/db/schema";
import { ApiError, apiHandler, page, pageParams } from "@/lib/api-auth";
import { after, uuidParam } from "../lib";

const KIND = z.enum(alerts.kind.enumValues), STATUS = z.enum(alerts.status.enumValues);

/** Alerts raised by the nightly check and the till (?status=open by default, ?kind=, ?branchId=). */
export function GET(req: Request) {
  return apiHandler(req, "alerts:read", async (t) => {
    const { limit, cursor, params } = pageParams(req);
    const kind = KIND.safeParse(params.get("kind") ?? undefined), status = STATUS.safeParse(params.get("status") ?? "open");
    if (params.get("kind") && !kind.success) throw new ApiError(400, `kind must be one of ${KIND.options.join(", ")}`);
    if (!status.success && params.get("status") !== "all") throw new ApiError(400, `status must be one of ${STATUS.options.join(", ")} or all`);
    const branchId = uuidParam(params.get("branchId"), "branchId");
    const rows = await t.select({
      id: alerts.id, branchId: alerts.branchId, kind: alerts.kind, status: alerts.status, title: alerts.title, detail: alerts.detail, valueMinor: alerts.valueMinor, dueOn: alerts.dueOn,
      productId: alerts.productId, batchId: alerts.batchId, customerId: alerts.customerId, resolution: alerts.resolution, resolvedAt: alerts.resolvedAt, createdAt: alerts.createdAt,
    }).from(alerts).where(after(alerts.id, cursor, kind.success && kind.data ? eq(alerts.kind, kind.data) : undefined, status.success && params.get("status") !== "all" ? eq(alerts.status, status.data) : undefined,
      branchId ? eq(alerts.branchId, branchId) : undefined)).orderBy(asc(alerts.id)).limit(limit + 1);
    return page(rows, limit);
  });
}
