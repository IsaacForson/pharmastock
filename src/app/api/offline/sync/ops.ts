import { z } from "zod";
import { saleInput } from "@/lib/sales";

const base = { id: z.number().int().nonnegative(), userId: z.uuid() };

/** Ops the offline outbox can replay. Validated at the trust boundary before anything touches the database. */
export const opSchema = z.discriminatedUnion("type", [
  // A sale made at the till with no connection; replayed with createSale(..., { offline: true }), idempotent on input.clientId.
  z.object({ ...base, type: z.literal("sale"), input: saleInput, totalMinor: z.number().int().optional() }),
  // A customer paying down their account at the till; idempotent on clientId.
  z.object({
    ...base, type: z.literal("repayment"),
    clientId: z.string().min(8).max(100), customerId: z.uuid(), customerName: z.string().max(200).optional(),
    amountMinor: z.number().int().positive().max(1_000_000_000),
    method: z.enum(["cash", "mobile_money", "card", "bank"]),
    reference: z.string().max(120).nullable().optional(),
  }),
]);
export const syncBody = z.object({ ops: z.array(opSchema).min(1).max(100) });

export type SyncOp = z.infer<typeof opSchema>;
/** Op as queued by the client (id is assigned by IndexedDB). Uses the input shape so sale defaults stay optional. */
type InOp = z.input<typeof opSchema>;
export type OutboxOp = InOp extends infer T ? (T extends InOp ? Omit<T, "id"> : never) : never;

/**
 * saved: applied. rejected: permanently refused (kept on the device for the user to review, never silently dropped).
 * retry: transient (server error, or queued by a different signed-in user) — stays pending.
 */
export type OpResult = { id: number; status: "saved" | "rejected" | "retry"; error?: string; saleId?: string; saleNo?: string };

export const OP_PERMISSION = { sale: "pos.sell", repayment: "pos.sell" } as const;
