import { and, asc, eq, gte, lt } from "drizzle-orm";
import { sales } from "@/db/schema";
import { apiActor, apiHandler, page, pageParams, readJson } from "@/lib/api-auth";
import { createSale, saleInput } from "@/lib/sales";
import { after, dateParam, uuidParam } from "../lib";
import { saleFields } from "./fields";

export function GET(req: Request) {
  return apiHandler(req, "sales:read", async (t) => {
    const { limit, cursor, params } = pageParams(req);
    const from = dateParam(params.get("from"), "from"), to = dateParam(params.get("to"), "to");
    const branchId = uuidParam(params.get("branchId"), "branchId"), customerId = uuidParam(params.get("customerId"), "customerId");
    const rows = await t.select(saleFields).from(sales).where(after(sales.id, cursor, from ? gte(sales.soldAt, new Date(from)) : undefined, to ? lt(sales.soldAt, new Date(to)) : undefined,
      branchId ? eq(sales.branchId, branchId) : undefined, customerId ? eq(sales.customerId, customerId) : undefined)).orderBy(asc(sales.id)).limit(limit + 1);
    return page(rows, limit);
  });
}

const apiSale = saleInput.extend({ branchId: saleInput.shape.customerId }).omit({ approverPin: true });

/**
 * Records a sale through the same engine as the till (FEFO stock, tax, credit, loyalty, register, sale.completed webhook).
 * The staff member who created the API key is the cashier; their discount limit and permissions apply. Pharmacist-only
 * items need that person to be a pharmacist. Idempotent on clientId: resending returns the original sale (200).
 */
export function POST(req: Request) {
  return apiHandler(req, "sales:write", async (t, k) => {
    const { branchId, ...input } = apiSale.parse(await readJson(req));
    const [dup] = await t.select({ id: sales.id }).from(sales).where(eq(sales.clientId, input.clientId));
    const ctx = await apiActor(t, k, branchId);
    const sale = await createSale(t, ctx, input);
    const [row] = await t.select(saleFields).from(sales).where(and(eq(sales.id, sale.id)));
    return Response.json(row, { status: dup ? 200 : 201 });
  });
}
