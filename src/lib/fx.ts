import { eq } from "drizzle-orm";
import { adminDb } from "@/db";
import { fxRates } from "@/db/schema";
import { DEFAULT_PER_USD } from "./money";

// Plain module (no server-only/next imports) so the background worker can run it.
/** Refreshes unlocked rates from a free public feed (no key). Returns how many were updated. */
export async function refreshRates(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`FX feed ${res.status}`);
  const json = (await res.json()) as { result?: string; rates?: Record<string, number> };
  if (json.result !== "success" || !json.rates) throw new Error("FX feed returned no rates");
  const locked = new Set((await adminDb().select({ c: fxRates.currency }).from(fxRates).where(eq(fxRates.locked, true))).map((r) => r.c));
  let n = 0;
  for (const cur of Object.keys(DEFAULT_PER_USD)) {
    const v = json.rates[cur];
    if (!v || locked.has(cur)) continue;
    await adminDb().insert(fxRates).values({ currency: cur, perUsd: v, source: "open.er-api.com" })
      .onConflictDoUpdate({ target: fxRates.currency, set: { perUsd: v, source: "open.er-api.com", updatedAt: new Date() } });
    n++;
  }
  return n;
}

