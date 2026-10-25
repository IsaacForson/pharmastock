import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import { branches, customers, payers, payments, prescriptions, productUnits, products, saleLines, sales, stockBatches, users, type Tenant } from "@/db/schema";
import { rulesFor } from "@/lib/compliance";
import { isMedicine, type ReceiptData } from "@/lib/receipt";
import { receiptUrl } from "@/app/r/token";

/** Everything printed on a sale's receipt, from the database. Works with RLS (tx) or adminDb filtered by tenant. */
export async function loadReceipt(t: Tx, tenant: Tenant, saleId: string): Promise<ReceiptData | null> {
  const [sale] = await t.select().from(sales).where(and(eq(sales.id, saleId), eq(sales.tenantId, tenant.id))).limit(1);
  if (!sale) return null;
  const lines = await t.select({ line: saleLines, schedule: products.schedule, unitName: productUnits.name })
    .from(saleLines).innerJoin(products, eq(products.id, saleLines.productId)).innerJoin(productUnits, eq(productUnits.id, saleLines.unitId))
    .where(eq(saleLines.saleId, sale.id)).orderBy(saleLines.id);
  const batchIds = [...new Set(lines.flatMap((l) => l.line.allocations.map((a) => a.batchId)))];
  const batches = batchIds.length ? await t.select({ id: stockBatches.id, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry }).from(stockBatches).where(inArray(stockBatches.id, batchIds)) : [];
  const pays = await t.select().from(payments).where(and(eq(payments.saleId, sale.id), eq(payments.status, "succeeded"))).orderBy(payments.receivedAt);
  const people = [sale.cashierId, sale.pharmacistId].filter(Boolean) as string[];
  const staff = people.length ? await t.select({ id: users.id, name: users.name, regNo: users.regNo }).from(users).where(inArray(users.id, people)) : [];
  const [branch] = await t.select().from(branches).where(eq(branches.id, sale.branchId));
  const [customer] = sale.customerId ? await t.select().from(customers).where(eq(customers.id, sale.customerId)) : [];
  const [payer] = sale.payerId ? await t.select().from(payers).where(eq(payers.id, sale.payerId)) : [];
  const [rx] = sale.prescriptionId ? await t.select({ rxNo: prescriptions.rxNo }).from(prescriptions).where(eq(prescriptions.id, sale.prescriptionId)) : [];
  const rules = rulesFor(tenant.country);
  const pharmacist = staff.find((s) => s.id === sale.pharmacistId);
  // Cash rows are stored net of change; show what was handed over.
  let change = sale.changeMinor;
  const shown = pays.filter((p) => p.amountMinor > 0 && p.method !== "insurance").map((p) => {
    const extra = p.method === "cash" ? change : 0;
    change -= extra;
    return { method: p.method, amountMinor: p.amountMinor + extra, reference: p.reference };
  });
  if (change > 0) shown.push({ method: "cash", amountMinor: change, reference: null });
  return {
    pharmacy: {
      name: tenant.name, branch: branch && !branch.isMain ? branch.name : null, address: branch?.address ?? tenant.address, phone: branch?.phone ?? tenant.phone,
      licenceNo: branch?.licenceNo ?? tenant.licenceNo, taxId: tenant.taxId, letterhead: tenant.letterhead, footer: tenant.receiptFooter,
      labelWarning: rules.labelWarning, taxName: rules.taxName, taxInclusive: tenant.pricesIncludeTax,
    },
    currency: tenant.currency, timezone: tenant.timezone,
    saleNo: sale.saleNo, receiptNo: pays.find((p) => p.receiptNo)?.receiptNo ?? null, soldAt: sale.soldAt.toISOString(), offline: sale.offline, status: sale.status,
    cashier: staff.find((s) => s.id === sale.cashierId)?.name ?? null, pharmacist: pharmacist?.name ?? null, pharmacistRegNo: pharmacist?.regNo ?? null,
    customer: customer ? { name: customer.name, customerNo: customer.customerNo, balanceMinor: customer.balanceMinor, points: customer.loyaltyPoints } : null,
    rxNo: rx?.rxNo ?? null,
    lines: lines.map(({ line, schedule, unitName }) => ({
      description: line.description, qty: line.qty, unitName, unitPriceMinor: line.unitPriceMinor, discountMinor: line.discountMinor, totalMinor: line.totalMinor,
      medicine: isMedicine(schedule), schedule, returnedQty: line.returnedBaseQty,
      batches: line.allocations.map((a) => batches.find((b) => b.id === a.batchId)).filter(Boolean).map((b) => ({ batchNo: b!.batchNo, expiry: b!.expiry })),
    })),
    subtotalMinor: sale.subtotalMinor, discountMinor: sale.discountMinor, taxMinor: sale.taxMinor, totalMinor: sale.totalMinor,
    payer: payer ? { name: payer.name, memberNo: sale.memberNo, portionMinor: sale.payerPortionMinor } : null,
    payments: shown, changeMinor: sale.changeMinor, creditMinor: sale.creditMinor,
    loyalty: sale.loyaltyEarned || sale.loyaltyRedeemed ? { earned: sale.loyaltyEarned, redeemed: sale.loyaltyRedeemed } : null,
    link: receiptUrl(sale.id),
  };
}
