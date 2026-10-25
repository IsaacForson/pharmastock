import { eq } from "drizzle-orm";
import { purchaseOrderLines, purchaseOrders } from "@/db/schema";
import { apiHandler } from "@/lib/api-auth";
import { notFound, uuidParam } from "../../lib";
import { poFields } from "../fields";

export async function GET(req: Request, { params }: RouteContext<"/api/v1/purchase-orders/[id]">) {
  const id = uuidParam((await params).id, "id")!;
  return apiHandler(req, "purchase_orders:read", async (t) => {
    const [po] = await t.select(poFields).from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!po) notFound();
    const lines = await t.select({
      id: purchaseOrderLines.id, productId: purchaseOrderLines.productId, unitId: purchaseOrderLines.unitId, qty: purchaseOrderLines.qty, unitCostMinor: purchaseOrderLines.unitCostMinor,
      supplierQty: purchaseOrderLines.supplierQty, supplierCostMinor: purchaseOrderLines.supplierCostMinor, receivedBaseQty: purchaseOrderLines.receivedBaseQty,
    }).from(purchaseOrderLines).where(eq(purchaseOrderLines.poId, id));
    return { ...po, lines };
  });
}
