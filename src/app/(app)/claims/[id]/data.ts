import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { claimItems, claims, customers, payers, sales } from "@/db/schema";

export async function loadClaim(t: Tx, id: string) {
  const [row] = await t.select({ c: claims, payer: payers }).from(claims).innerJoin(payers, eq(payers.id, claims.payerId)).where(eq(claims.id, id));
  if (!row) return null;
  const items = await t.select({ i: claimItems, saleNo: sales.saleNo, soldAt: sales.soldAt, total: sales.totalMinor, memberNo: sales.memberNo, customer: customers.name, customerNo: customers.customerNo })
    .from(claimItems).innerJoin(sales, eq(sales.id, claimItems.saleId)).leftJoin(customers, eq(customers.id, sales.customerId))
    .where(eq(claimItems.claimId, id)).orderBy(sales.soldAt);
  return { ...row, items };
}
