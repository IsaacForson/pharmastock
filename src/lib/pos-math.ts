/**
 * Pure till maths shared by the server (authoritative) and the POS screen (preview, offline). All amounts are integer
 * minor units; tax rates are basis points (1500 = 15%).
 */

export type LineInput = { unitPriceMinor: number; qty: number; discountMinor?: number; taxBp: number };
export type LineResult = { grossMinor: number; discountMinor: number; taxMinor: number; totalMinor: number };

/** Tax-inclusive prices back the tax out of the total; exclusive prices add it on top. */
export function lineTotals(l: LineInput, inclusive: boolean): LineResult {
  const gross = l.unitPriceMinor * l.qty;
  const discount = Math.min(Math.max(0, Math.round(l.discountMinor ?? 0)), gross);
  const net = gross - discount;
  if (inclusive) {
    const tax = Math.round((net * l.taxBp) / (10_000 + l.taxBp));
    return { grossMinor: gross, discountMinor: discount, taxMinor: tax, totalMinor: net };
  }
  const tax = Math.round((net * l.taxBp) / 10_000);
  return { grossMinor: gross, discountMinor: discount, taxMinor: tax, totalMinor: net + tax };
}

/**
 * Spreads a sale-level discount over lines in proportion to their value (largest remainder, so it sums exactly),
 * so each line's tax is computed on what was really charged.
 */
export function spreadDiscount(lineNets: number[], discountMinor: number): number[] {
  const total = lineNets.reduce((a, b) => a + b, 0);
  const d = Math.min(Math.max(0, Math.round(discountMinor)), total);
  if (!d || !total) return lineNets.map(() => 0);
  const raw = lineNets.map((n) => (n * d) / total);
  const out = raw.map(Math.floor);
  let left = d - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) { if (!left) break; out[i]++; left--; }
  return out;
}

export type SaleLineInput = LineInput & { key: string };
export type SaleTotals = {
  lines: (LineResult & { key: string })[];
  subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number;
};

/** Totals for a whole cart: line discounts first, then the sale discount spread across lines. */
export function saleTotals(lines: SaleLineInput[], saleDiscountMinor: number, inclusive: boolean): SaleTotals {
  const afterLine = lines.map((l) => l.unitPriceMinor * l.qty - Math.min(Math.max(0, Math.round(l.discountMinor ?? 0)), l.unitPriceMinor * l.qty));
  const extra = spreadDiscount(afterLine, saleDiscountMinor);
  const out = lines.map((l, i) => ({ key: l.key, ...lineTotals({ ...l, discountMinor: (l.discountMinor ?? 0) + extra[i] }, inclusive) }));
  return {
    lines: out,
    subtotalMinor: out.reduce((a, l) => a + l.grossMinor, 0),
    discountMinor: out.reduce((a, l) => a + l.discountMinor, 0),
    taxMinor: out.reduce((a, l) => a + l.taxMinor, 0),
    totalMinor: out.reduce((a, l) => a + l.totalMinor, 0),
  };
}

/** Points earned on what the customer actually paid (not on the payer's share or redeemed points). */
export const loyaltyEarned = (paidMinor: number, earnPerMajor: number) => Math.max(0, Math.floor((paidMinor / 100) * earnPerMajor));

export type FefoBatch = { id: string; qtyOnHand: number; expiry: string | null; quarantined?: boolean };
export type Allocation = { batchId: string; qty: number };

/**
 * First-expiry-first-out: takes from the batch expiring soonest, skipping expired, quarantined and empty batches.
 * Batches without an expiry go last; ties keep input order. `short` > 0 means not enough sellable stock.
 */
export function allocateFefo(batches: FefoBatch[], qty: number, today: string): { allocations: Allocation[]; short: number } {
  const usable = batches
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.qtyOnHand > 0 && !b.quarantined && (!b.expiry || b.expiry >= today))
    .sort((x, y) => (x.b.expiry ?? "9999-12-31").localeCompare(y.b.expiry ?? "9999-12-31") || x.i - y.i);
  const allocations: Allocation[] = [];
  let left = Math.max(0, qty);
  for (const { b } of usable) {
    if (left === 0) break;
    const take = Math.min(left, b.qtyOnHand);
    allocations.push({ batchId: b.id, qty: take });
    left -= take;
  }
  return { allocations, short: left };
}
