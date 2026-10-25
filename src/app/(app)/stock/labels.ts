import type { stockMovements } from "@/db/schema";

type MoveType = (typeof stockMovements.$inferSelect)["type"];
export const MOVE_LABEL: Record<MoveType, string> = {
  receive: "Received", sale: "Sold", sale_return: "Customer return", adjust: "Correction", transfer_out: "Transferred out",
  transfer_in: "Transferred in", expire: "Expired write-off", supplier_return: "Returned to supplier", stocktake: "Stock take", damage: "Damaged",
};
export const MOVE_TYPES = Object.keys(MOVE_LABEL) as MoveType[];
