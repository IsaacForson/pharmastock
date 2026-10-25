import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { counters } from "@/db/schema";

const PREFIX: Record<string, string> = {
  sale: "SL", receipt: "RCT", grn: "GRN", po: "PO", transfer: "TRF", return: "RTN", supplier_return: "SRN",
  stocktake: "STK", rx: "RX", customer: "C", claim: "CLM",
};

/** Next value of a per-tenant counter. Row lock keeps it gap-free under concurrency. */
export async function nextCounter(t: Tx, tenantId: string, key: string): Promise<number> {
  const [row] = await t.insert(counters).values({ tenantId, key, value: 1 })
    .onConflictDoUpdate({ target: [counters.tenantId, counters.key], set: { value: sql`${counters.value} + 1` } })
    .returning({ value: counters.value });
  return row.value;
}

/** Next human-readable number per tenant, e.g. SL-000123. */
export async function nextNumber(t: Tx, tenantId: string, key: keyof typeof PREFIX | string): Promise<string> {
  return `${PREFIX[key] ?? key.toUpperCase()}-${String(await nextCounter(t, tenantId, key)).padStart(6, "0")}`;
}
