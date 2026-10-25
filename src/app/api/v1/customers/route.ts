import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { customers } from "@/db/schema";
import { apiAudit, apiHandler, assertWritable, page, pageParams, readJson } from "@/lib/api-auth";
import { emit } from "@/lib/events";
import { e164 } from "@/lib/format";
import { nextNumber } from "@/lib/numbers";
import { after } from "../lib";
import { customerFields, customerInput } from "./fields";

export function GET(req: Request) {
  return apiHandler(req, "customers:read", async (t, k) => {
    const { limit, cursor, params } = pageParams(req);
    const phone = params.get("phone"), qs = params.get("q");
    const like = qs ? `%${qs.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await t.select(customerFields).from(customers).where(after(customers.id, cursor, isNull(customers.deletedAt),
      phone ? eq(customers.phone, e164(phone, k.tenant.country) ?? "") : undefined, like ? or(ilike(customers.name, like), ilike(customers.customerNo, like)) : undefined))
      .orderBy(asc(customers.id)).limit(limit + 1);
    await apiAudit(t, k, "view", "customer", null, null, { list: true, count: Math.min(rows.length, limit) });
    return page(rows.map((r) => ({ ...r, optedOut: !!r.optedOut })), limit);
  });
}

/** Messaging consent is not settable here: it is recorded at the counter or by the customer replying START. */
export function POST(req: Request) {
  return apiHandler(req, "customers:write", async (t, k) => {
    await assertWritable(t, k);
    const input = customerInput.parse(await readJson(req));
    const phone = e164(input.phone, k.tenant.country);
    const customerNo = await nextNumber(t, k.tenantId, "customer");
    const [c] = await t.insert(customers).values({ ...input, phone, tenantId: k.tenantId, customerNo }).returning({ id: customers.id });
    await apiAudit(t, k, "create", "customer", c.id, c.id);
    await emit(t, k.tenantId, "customer.created", { id: c.id, customerNo });
    const [row] = await t.select(customerFields).from(customers).where(and(eq(customers.id, c.id)));
    return Response.json({ ...row, optedOut: !!row.optedOut }, { status: 201 });
  });
}
