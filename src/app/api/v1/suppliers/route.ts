import { asc, eq } from "drizzle-orm";
import { suppliers } from "@/db/schema";
import { apiHandler, page, pageParams } from "@/lib/api-auth";
import { after } from "../lib";

export function GET(req: Request) {
  return apiHandler(req, "suppliers:read", async (t) => {
    const { limit, cursor, params } = pageParams(req);
    const rows = await t.select({
      id: suppliers.id, name: suppliers.name, contactName: suppliers.contactName, phone: suppliers.phone, email: suppliers.email, address: suppliers.address, licenceNo: suppliers.licenceNo,
      paymentTermsDays: suppliers.paymentTermsDays, returnMinDaysToExpiry: suppliers.returnMinDaysToExpiry, returnWithinDaysOfDelivery: suppliers.returnWithinDaysOfDelivery,
      leadTimeDays: suppliers.leadTimeDays, active: suppliers.active, createdAt: suppliers.createdAt,
    }).from(suppliers).where(after(suppliers.id, cursor, params.get("active") === "all" ? undefined : eq(suppliers.active, true))).orderBy(asc(suppliers.id)).limit(limit + 1);
    return page(rows, limit);
  });
}
