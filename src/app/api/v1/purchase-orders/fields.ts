import { purchaseOrders } from "@/db/schema";

export const poFields = {
  id: purchaseOrders.id, poNo: purchaseOrders.poNo, branchId: purchaseOrders.branchId, supplierId: purchaseOrders.supplierId, status: purchaseOrders.status, expectedAt: purchaseOrders.expectedAt,
  totalMinor: purchaseOrders.totalMinor, sentAt: purchaseOrders.sentAt, sentVia: purchaseOrders.sentVia, confirmedAt: purchaseOrders.confirmedAt, supplierNote: purchaseOrders.supplierNote, createdAt: purchaseOrders.createdAt,
};
