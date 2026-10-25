import { and, asc, eq, isNull, like, or } from "drizzle-orm";
import { alerts, recalls, stockBatches, tenants } from "@/db/schema";
import { apiHandler, page, pageParams } from "@/lib/api-auth";
import { after } from "../lib";

/**
 * Recall feed for this pharmacy: regulator recall notices for its country (and global ones), each with the batches the
 * nightly check matched and quarantined here (batch number, expiry, branch, quantity still held).
 */
export function GET(req: Request) {
  return apiHandler(req, "recalls:read", async (t, k) => {
    const { limit, cursor, params } = pageParams(req);
    const [tenant] = await t.select({ country: tenants.country }).from(tenants).where(eq(tenants.id, k.tenantId));
    const rows = await t.select({
      id: recalls.id, country: recalls.country, productName: recalls.productName, genericName: recalls.genericName, manufacturer: recalls.manufacturer, batchNos: recalls.batchNos,
      reason: recalls.reason, source: recalls.source, publishedOn: recalls.publishedOn,
    }).from(recalls).where(after(recalls.id, cursor, or(isNull(recalls.country), eq(recalls.country, tenant.country)))).orderBy(asc(recalls.id)).limit(limit + 1);
    const p = page(rows, limit);
    const data = [];
    for (const r of p.data) {
      const matched = await t.select({ alertId: alerts.id, alertStatus: alerts.status, batchId: stockBatches.id, branchId: stockBatches.branchId, productId: stockBatches.productId,
        batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, qtyOnHand: stockBatches.qtyOnHand, quarantined: stockBatches.quarantined })
        .from(alerts).innerJoin(stockBatches, eq(stockBatches.id, alerts.batchId)).where(and(eq(alerts.kind, "recall"), like(alerts.dedupeKey, `recall:${r.id}:%`)));
      if (params.get("matched") === "true" && !matched.length) continue;
      data.push({ ...r, matchedBatches: matched });
    }
    return { data, nextCursor: p.nextCursor };
  });
}
