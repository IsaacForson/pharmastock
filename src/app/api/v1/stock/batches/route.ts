import { and, asc, eq, gt, lte } from "drizzle-orm";
import { stockBatches } from "@/db/schema";
import { apiHandler, page, pageParams } from "@/lib/api-auth";
import { addDays, localDay } from "@/lib/format";
import { after, uuidParam } from "../../lib";

/** Batches in stock with batch number and expiry. ?expiringWithinDays=90 lists only those expiring by then (expired included). */
export function GET(req: Request) {
  return apiHandler(req, "stock:read", async (t, k) => {
    const { limit, cursor, params } = pageParams(req);
    const productId = uuidParam(params.get("productId"), "productId"), branchId = uuidParam(params.get("branchId"), "branchId");
    const within = params.get("expiringWithinDays");
    const rows = await t.select({
      id: stockBatches.id, productId: stockBatches.productId, branchId: stockBatches.branchId, batchNo: stockBatches.batchNo, mfgDate: stockBatches.mfgDate, expiry: stockBatches.expiry,
      qtyOnHand: stockBatches.qtyOnHand, unitCostMinor: stockBatches.unitCostMinor, supplierId: stockBatches.supplierId, receivedAt: stockBatches.receivedAt,
      quarantined: stockBatches.quarantined, quarantineReason: stockBatches.quarantineReason,
    }).from(stockBatches).where(after(stockBatches.id, cursor, gt(stockBatches.qtyOnHand, 0), productId ? eq(stockBatches.productId, productId) : undefined,
      branchId ? eq(stockBatches.branchId, branchId) : undefined, within ? lte(stockBatches.expiry, addDays(localDay(k.tenant.timezone), Math.min(Math.max(Number(within) || 0, 0), 3650))) : undefined))
      .orderBy(asc(stockBatches.id)).limit(limit + 1);
    return page(rows, limit);
  });
}
