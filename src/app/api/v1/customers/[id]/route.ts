import { and, eq, isNull } from "drizzle-orm";
import { customers } from "@/db/schema";
import { apiAudit, apiHandler, assertWritable, readJson } from "@/lib/api-auth";
import { e164 } from "@/lib/format";
import { notFound, uuidParam } from "../../lib";
import { customerFields, customerInput } from "../fields";

export async function GET(req: Request, { params }: RouteContext<"/api/v1/customers/[id]">) {
  const id = uuidParam((await params).id, "id")!;
  return apiHandler(req, "customers:read", async (t, k) => {
    const [c] = await t.select(customerFields).from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    if (!c) notFound();
    await apiAudit(t, k, "view", "customer", id, id);
    return { ...c, optedOut: !!c.optedOut };
  });
}

export async function PATCH(req: Request, { params }: RouteContext<"/api/v1/customers/[id]">) {
  const id = uuidParam((await params).id, "id")!;
  return apiHandler(req, "customers:write", async (t, k) => {
    await assertWritable(t, k);
    const input = customerInput.partial().parse(await readJson(req));
    const set = { ...input, ...(input.phone !== undefined ? { phone: e164(input.phone, k.tenant.country) } : {}) };
    const done = Object.keys(set).length ? await t.update(customers).set(set).where(and(eq(customers.id, id), isNull(customers.deletedAt))).returning({ id: customers.id })
      : await t.select({ id: customers.id }).from(customers).where(and(eq(customers.id, id), isNull(customers.deletedAt)));
    if (!done.length) notFound();
    await apiAudit(t, k, "update", "customer", id, id, { fields: Object.keys(set) });
    const [c] = await t.select(customerFields).from(customers).where(eq(customers.id, id));
    return { ...c, optedOut: !!c.optedOut };
  });
}
