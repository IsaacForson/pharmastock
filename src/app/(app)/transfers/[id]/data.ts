import { aliasedTable, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { branches, products, stockBatches, transferLines, transfers, users } from "@/db/schema";
import { tx, type Ctx } from "@/lib/auth";

/** A transfer with branch names, sender/receiver and lines with their source batch. Only for branches the user works at. */
export async function loadTransfer(ctx: Ctx, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const from = aliasedTable(branches, "from_b"), to = aliasedTable(branches, "to_b");
  const sender = aliasedTable(users, "sender"), receiver = aliasedTable(users, "receiver");
  const data = await tx(ctx, async (t) => {
    const [h] = await t.select({ tr: transfers, fromName: from.name, fromAddress: from.address, toName: to.name, toAddress: to.address, sentBy: sender.name, receivedBy: receiver.name })
      .from(transfers).innerJoin(from, eq(from.id, transfers.fromBranchId)).innerJoin(to, eq(to.id, transfers.toBranchId))
      .leftJoin(sender, eq(sender.id, transfers.sentBy)).leftJoin(receiver, eq(receiver.id, transfers.receivedBy)).where(eq(transfers.id, id));
    if (!h) return null;
    const lines = await t.select({ l: transferLines, name: products.name, strength: products.strength, baseUnit: products.baseUnit, schedule: products.schedule, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, cost: stockBatches.unitCostMinor })
      .from(transferLines).innerJoin(products, eq(products.id, transferLines.productId)).innerJoin(stockBatches, eq(stockBatches.id, transferLines.fromBatchId))
      .where(eq(transferLines.transferId, id)).orderBy(asc(products.name));
    return { ...h, lines };
  });
  const mine = new Set(ctx.branches.map((b) => b.id));
  if (!data || (!mine.has(data.tr.fromBranchId) && !mine.has(data.tr.toBranchId))) notFound();
  return data;
}
