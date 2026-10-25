import { sales } from "@/db/schema";

export const saleFields = {
  id: sales.id, saleNo: sales.saleNo, branchId: sales.branchId, status: sales.status, customerId: sales.customerId, prescriptionId: sales.prescriptionId, payerId: sales.payerId,
  subtotalMinor: sales.subtotalMinor, discountMinor: sales.discountMinor, taxMinor: sales.taxMinor, totalMinor: sales.totalMinor, payerPortionMinor: sales.payerPortionMinor,
  paidMinor: sales.paidMinor, creditMinor: sales.creditMinor, changeMinor: sales.changeMinor, offline: sales.offline, clientId: sales.clientId, cashierId: sales.cashierId, soldAt: sales.soldAt,
};
