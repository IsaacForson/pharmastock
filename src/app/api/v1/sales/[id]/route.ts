import { eq } from "drizzle-orm";
import { payments, saleLines, sales } from "@/db/schema";
import { apiHandler } from "@/lib/api-auth";
import { notFound, uuidParam } from "../../lib";
import { saleFields } from "../fields";

/** A sale with its lines (batches allocated FEFO) and payments: everything an e-invoice needs. */
export async function GET(req: Request, { params }: RouteContext<"/api/v1/sales/[id]">) {
  const id = uuidParam((await params).id, "id")!;
  return apiHandler(req, "sales:read", async (t) => {
    const [sale] = await t.select(saleFields).from(sales).where(eq(sales.id, id));
    if (!sale) notFound();
    const lines = await t.select({
      id: saleLines.id, productId: saleLines.productId, unitId: saleLines.unitId, description: saleLines.description, qty: saleLines.qty, baseQty: saleLines.baseQty,
      unitPriceMinor: saleLines.unitPriceMinor, discountMinor: saleLines.discountMinor, taxBp: saleLines.taxBp, taxMinor: saleLines.taxMinor, totalMinor: saleLines.totalMinor,
      returnedBaseQty: saleLines.returnedBaseQty, allocations: saleLines.allocations,
    }).from(saleLines).where(eq(saleLines.saleId, id));
    const pays = await t.select({ id: payments.id, method: payments.method, amountMinor: payments.amountMinor, status: payments.status, reference: payments.reference, receiptNo: payments.receiptNo, receivedAt: payments.receivedAt })
      .from(payments).where(eq(payments.saleId, id));
    return { ...sale, lines: lines.map(({ allocations, ...l }) => ({ ...l, batches: allocations.map(({ batchId, qty }) => ({ batchId, qty })) })), payments: pays };
  });
}
