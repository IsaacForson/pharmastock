/**
 * Pure analytics maths shared by reports, the dashboard, the accounting export and "Ask PharmaStock". No DB access, unit
 * tested in src/lib/__tests__/analytics.test.ts. Money is integer minor units.
 */
import type { Role } from "@/db/schema";

export const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);

// ---------- Branch scope ----------
/**
 * Which branches a report or dashboard covers. Owners and managers on a plan with consolidated views may pick "all";
 * everyone else sees one of the branches they are allowed into (defaulting to the one they work at).
 */
export function branchScope(o: {
  role: Role; consolidated: boolean; branches: { id: string }[]; current: string; wanted?: string | string[] | null; defaultAll?: boolean;
}): { ids: string[]; all: boolean; canAll: boolean } {
  const canAll = o.consolidated && (o.role === "owner" || o.role === "admin") && o.branches.length > 1;
  const w = typeof o.wanted === "string" ? o.wanted : undefined;
  if (canAll && (w === "all" || (!w && o.defaultAll))) return { ids: o.branches.map((b) => b.id), all: true, canAll };
  const one = o.branches.find((b) => b.id === w)?.id ?? o.current;
  return { ids: [one], all: false, canAll };
}

// ---------- ABC analysis ----------
export type AbcClass = "A" | "B" | "C";
/**
 * Ranks items by revenue. A = the items making the first 80% of revenue, B = the next 15%, C = the rest (including
 * items with no sales). The item that crosses a cut-off belongs to the higher class.
 */
export function abcClassify<T extends { revenue: number }>(rows: T[], cuts: [number, number] = [80, 95]) {
  const total = rows.reduce((s, r) => s + Math.max(r.revenue, 0), 0);
  let cum = 0;
  return [...rows].sort((a, b) => b.revenue - a.revenue).map((r) => {
    const before = total ? (cum / total) * 100 : 100;
    cum += Math.max(r.revenue, 0);
    const abc: AbcClass = r.revenue <= 0 ? "C" : before < cuts[0] ? "A" : before < cuts[1] ? "B" : "C";
    return { ...r, share: pct(r.revenue, total), cumShare: pct(cum, total), abc };
  });
}

// ---------- Dead stock ----------
/**
 * Items holding stock that have not sold since `cutoff` (ISO instant) and were already on the shelf before it (so a
 * delivery that arrived last week is not "dead"). Sorted by value tied up, largest first.
 */
export function deadStock<T extends { lastSoldAt: string | Date | null; firstReceivedAt: string | Date | null; onHand: number; value: number }>(rows: T[], cutoff: Date) {
  const c = cutoff.getTime();
  const at = (v: string | Date | null) => (v ? new Date(v).getTime() : null);
  return rows.filter((r) => {
    if (r.onHand <= 0) return false;
    const sold = at(r.lastSoldAt), recv = at(r.firstReceivedAt);
    return (sold === null || sold < c) && (recv === null || recv < c);
  }).sort((a, b) => b.value - a.value);
}

// ---------- Price-change impact ----------
export type Window = { units: number; revenue: number; cost: number; days: number };
/** Units per day and margin before vs after a price change. Margin = revenue (ex tax) − cost. */
export function priceImpact(before: Window, after: Window) {
  const perDay = (v: number, d: number) => (d > 0 ? v / d : 0);
  const ub = perDay(before.units, before.days), ua = perDay(after.units, after.days);
  const mb = perDay(before.revenue - before.cost, before.days), ma = perDay(after.revenue - after.cost, after.days);
  return {
    unitsPerDayBefore: round2(ub), unitsPerDayAfter: round2(ua), unitsChangePct: ub ? pct(ua - ub, ub) : null,
    marginPctBefore: pct(before.revenue - before.cost, before.revenue), marginPctAfter: pct(after.revenue - after.cost, after.revenue),
    marginPerDayBefore: Math.round(mb), marginPerDayAfter: Math.round(ma), marginPerDayChange: Math.round(ma - mb),
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Expiry losses ----------
/**
 * Monthly expiry write-offs against a baseline (the average of the first `baselineMonths` months shown, which for a new
 * pharmacy is the "before alerts" period). Also write-off as a share of cost of goods sold that month.
 */
export function expiryTrend(months: { month: string; writeOff: number; cogs: number }[], baselineMonths = 3) {
  const base = months.slice(0, baselineMonths);
  const baseline = base.length ? Math.round(base.reduce((s, m) => s + m.writeOff, 0) / base.length) : 0;
  return {
    baseline,
    rows: months.map((m) => ({ ...m, pctOfCogs: pct(m.writeOff, m.cogs), vsBaseline: baseline ? pct(m.writeOff - baseline, baseline) : null })),
  };
}

// ---------- Customer credit aging ----------
export const AGING = ["0–30 days", "31–60 days", "61–90 days", "90+ days"] as const;
/**
 * Splits what a customer owes into age buckets. Repayments settle the oldest debt first, so the outstanding balance is
 * made of the most recent charges: walk charges newest-first until the balance is used up.
 */
export function ageBalance(balance: number, charges: { amount: number; day: string }[], today: string): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  let left = Math.max(balance, 0);
  const t = Date.parse(`${today}T00:00:00Z`);
  for (const c of [...charges].filter((c) => c.amount > 0).sort((a, b) => b.day.localeCompare(a.day))) {
    if (!left) break;
    const take = Math.min(left, c.amount);
    const age = Math.floor((t - Date.parse(`${c.day}T00:00:00Z`)) / 86400_000);
    out[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += take;
    left -= take;
  }
  out[3] += left; // owed with no matching charge on record (opening balances): treat as oldest
  return out;
}

// ---------- Expiry actions ----------
export type ExpiryAction = "discount" | "transfer" | "return" | "write_off";
/**
 * Suggested action for a batch nearing expiry, in order of money recovered: return to the supplier while their window
 * is open, move it to a branch that sells it fast enough, sell it through with a discount, otherwise write it off.
 */
export function suggestExpiryAction(o: {
  daysLeft: number; qty: number; dailySales: number; returnable: boolean; fasterBranch?: { name: string; dailySales: number } | null;
}): { action: ExpiryAction; text: string } {
  if (o.daysLeft < 0) return { action: "write_off", text: "Expired: take it off the shelf, quarantine it and write it off (or return it if the supplier accepts expired stock)." };
  const sellThrough = o.dailySales * o.daysLeft;
  if (sellThrough >= o.qty) return { action: "discount", text: "Should sell through before expiry at the current pace. Keep it at the front of the shelf (FEFO)." };
  if (o.returnable) return { action: "return", text: "Return to the supplier while their return window is still open." };
  if (o.fasterBranch && o.fasterBranch.dailySales * o.daysLeft >= o.qty * 0.5) {
    return { action: "transfer", text: `Transfer to ${o.fasterBranch.name}, which sells about ${round2(o.fasterBranch.dailySales)} a day.` };
  }
  if (o.daysLeft <= 30 && sellThrough < o.qty * 0.25) return { action: "write_off", text: "Unlikely to sell before expiry. Discount hard now or plan to write it off." };
  return { action: "discount", text: `About ${Math.max(o.qty - Math.floor(sellThrough), 0)} won't sell in time at the current pace. Discount it or bundle it.` };
}

// ---------- Accounting journal ----------
export const METHOD_ACCOUNT: Record<string, string> = {
  cash: "Cash on hand", mobile_money: "Mobile money", card: "Card clearing", bank: "Bank", insurance: "Insurance receivable",
  credit: "Customer accounts receivable", loyalty: "Loyalty points liability",
};
export type JournalInput = {
  revenueByRate: { taxBp: number; net: number; tax: number }[]; // non-voided sales in the period
  salePayments: { method: string; amount: number }[]; // what settled those sales
  creditGiven: number; payerPortion: number;
  returns: { method: string; amount: number }[]; // refunds to customers
  cogs: number; // cost of goods sold net of restocked returns
  receipts: number; // goods received (at invoice value)
  supplierReturns: number; supplierPayments: { method: string; amount: number }[];
  repayments: { method: string; amount: number }[]; // customer account repayments
  expenses: { category: string; method: string; amount: number }[];
  writeOffs: number; // expiry + damage at cost
  adjustments: number; // count corrections at cost, signed (+ found stock)
};
export type JournalRow = { account: string; debit: number; credit: number; memo: string };

/** Double-entry journal for a period. Any difference from rounding or change-giving is posted to a rounding account. */
export function buildJournal(j: JournalInput): JournalRow[] {
  const rows: JournalRow[] = [];
  const dr = (account: string, amount: number, memo: string) => { if (amount > 0) rows.push({ account, debit: amount, credit: 0, memo }); else if (amount < 0) rows.push({ account, debit: 0, credit: -amount, memo }); };
  const cr = (account: string, amount: number, memo: string) => dr(account, -amount, memo);
  const acct = (m: string) => METHOD_ACCOUNT[m] ?? m;

  // Sales
  const start = rows.length;
  for (const p of j.salePayments) dr(acct(p.method), p.amount, "Sales takings");
  dr("Customer accounts receivable", j.creditGiven, "Sales on account");
  dr("Insurance receivable", j.payerPortion, "Insurer / HMO share of sales");
  for (const r of j.revenueByRate) {
    cr(`Sales revenue ${(r.taxBp / 100).toFixed(r.taxBp % 100 ? 2 : 0)}%`, r.net, "Sales excluding tax");
    cr("Output tax payable", r.tax, `Tax on sales at ${r.taxBp / 100}%`);
  }
  const diff = rows.slice(start).reduce((s, r) => s + r.debit - r.credit, 0);
  if (diff) cr("Rounding and cash differences", diff, "Balancing sales takings");

  for (const r of j.returns) { dr("Sales returns", r.amount, "Refunds to customers"); cr(acct(r.method), r.amount, "Refunds to customers"); }
  dr("Cost of goods sold", j.cogs, "Stock sold at cost (FEFO batch cost)"); cr("Inventory", j.cogs, "Stock sold at cost");
  dr("Inventory", j.receipts, "Goods received"); cr("Accounts payable", j.receipts, "Supplier invoices (goods received)");
  dr("Accounts payable", j.supplierReturns, "Stock returned to suppliers"); cr("Inventory", j.supplierReturns, "Stock returned to suppliers");
  for (const p of j.supplierPayments) { dr("Accounts payable", p.amount, "Supplier payments"); cr(acct(p.method), p.amount, "Supplier payments"); }
  for (const p of j.repayments) { dr(acct(p.method), p.amount, "Customer account repayments"); cr("Customer accounts receivable", p.amount, "Customer account repayments"); }
  for (const e of j.expenses) { dr(`Expenses: ${e.category}`, e.amount, "Shop expenses"); cr(acct(e.method), e.amount, `Expenses: ${e.category}`); }
  dr("Stock write-offs (expiry and damage)", j.writeOffs, "Expired and damaged stock at cost"); cr("Inventory", j.writeOffs, "Expired and damaged stock at cost");
  dr("Inventory", j.adjustments, "Stock count corrections at cost"); cr("Stock count differences", j.adjustments, "Stock count corrections at cost");
  return rows;
}
