import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { purchaseOrders } from "@/db/schema";
import { ApiError, apiHandler, page, pageParams } from "@/lib/api-auth";
import { after, uuidParam } from "../lib";
import { poFields } from "./fields";

const STATUS = z.enum(purchaseOrders.status.enumValues);

export function GET(req: Request) {
  return apiHandler(req, "purchase_orders:read", async (t) => {
    const { limit, cursor, params } = pageParams(req);
    const status = params.get("status");
    if (status && !STATUS.safeParse(status).success) throw new ApiError(400, `status must be one of ${STATUS.options.join(", ")}`);
    const supplierId = uuidParam(params.get("supplierId"), "supplierId"), branchId = uuidParam(params.get("branchId"), "branchId");
    const rows = await t.select(poFields).from(purchaseOrders).where(after(purchaseOrders.id, cursor, status ? eq(purchaseOrders.status, STATUS.parse(status)) : undefined,
      supplierId ? eq(purchaseOrders.supplierId, supplierId) : undefined, branchId ? eq(purchaseOrders.branchId, branchId) : undefined)).orderBy(asc(purchaseOrders.id)).limit(limit + 1);
    return page(rows, limit);
  });
}
