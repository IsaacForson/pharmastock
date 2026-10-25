import { sql } from "drizzle-orm";
import { apiHandler, pageParams } from "@/lib/api-auth";
import { localDay } from "@/lib/format";
import { uuidParam } from "../lib";

/** On-hand stock per product per branch (base units): sellable vs blocked (expired/quarantined), value at cost, next expiry. */
export function GET(req: Request) {
  return apiHandler(req, "stock:read", async (t, k) => {
    const { limit, cursor, params } = pageParams(req);
    const productId = uuidParam(params.get("productId"), "productId"), branchId = uuidParam(params.get("branchId"), "branchId");
    const today = localDay(k.tenant.timezone);
    // Cursor = product id; each page holds every branch row of `limit` products.
    const rows = (await t.execute(sql`with prod as (
        select id from products where active ${cursor ? sql`and id > ${cursor}` : sql``} ${productId ? sql`and id = ${productId}` : sql``} order by id limit ${limit + 1})
      select p.id as "productId", p.name, p.strength, p.base_unit as "baseUnit", b.branch_id as "branchId",
        coalesce(sum(b.qty_on_hand) filter (where not b.quarantined and (b.expiry is null or b.expiry >= ${today})), 0)::int as sellable,
        coalesce(sum(b.qty_on_hand) filter (where b.quarantined or b.expiry < ${today}), 0)::int as blocked,
        coalesce(sum(b.qty_on_hand), 0)::int as "onHand", coalesce(round(sum(b.qty_on_hand * b.unit_cost_minor)), 0)::float8 as "valueMinor",
        min(b.expiry) filter (where b.qty_on_hand > 0 and b.expiry >= ${today})::text as "nextExpiry"
      from prod join products p on p.id = prod.id left join stock_batches b on b.product_id = p.id and b.qty_on_hand > 0 ${branchId ? sql`and b.branch_id = ${branchId}` : sql``}
      group by p.id, p.name, p.strength, p.base_unit, b.branch_id order by p.id, b.branch_id`)) as unknown as { productId: string; branchId: string | null }[];
    const ids = [...new Set(rows.map((r) => r.productId))];
    const keep = new Set(ids.slice(0, limit));
    return { data: rows.filter((r) => keep.has(r.productId)), nextCursor: ids.length > limit ? ids[limit - 1] : null };
  });
}
