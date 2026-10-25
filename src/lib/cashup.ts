/**
 * Daily close maths (pure). Takes the day's payments, sales and expenses for one branch and works out what each drawer
 * should hold. Voided payments (status refunded) are ignored; return refunds are negative payments and reduce takings.
 */

export const DRAWER_METHODS = ["cash", "mobile_money", "card", "bank"] as const;
export type DrawerMethod = (typeof DRAWER_METHODS)[number];
type ByMethod = Record<DrawerMethod, number>;

export type CashupPayment = { method: string; amountMinor: number; status: string; saleId: string | null; receivedBy: string | null };
export type CashupSale = { status: string; totalMinor: number; creditMinor: number; payerPortionMinor: number; cashierId: string | null; offline?: boolean };
export type CashupExpense = { method: string; amountMinor: number };

export type CashupSummary = {
  takings: ByMethod; // all money received by method, net of refunds
  refunds: ByMethod; // return refunds paid out (positive numbers)
  repayments: ByMethod; // account repayments (included in takings)
  expenses: ByMethod; // expenses paid out of each drawer
  expected: ByMethod; // takings - expenses: what each drawer should hold
  salesCount: number; salesTotal: number; voidedCount: number; voidedTotal: number; offlineCount: number;
  creditGiven: number; payerPortion: number; repaymentTotal: number; expenseTotal: number;
  perCashier: { userId: string | null; sales: number; total: number; takings: ByMethod }[];
};

const zero = (): ByMethod => ({ cash: 0, mobile_money: 0, card: 0, bank: 0 });
const isDrawer = (m: string): m is DrawerMethod => (DRAWER_METHODS as readonly string[]).includes(m);

export function summarizeDay(o: { payments: CashupPayment[]; sales: CashupSale[]; expenses: CashupExpense[] }): CashupSummary {
  const takings = zero(), refunds = zero(), repayments = zero(), expenses = zero();
  const cashiers = new Map<string | null, { userId: string | null; sales: number; total: number; takings: ByMethod }>();
  const who = (id: string | null) => {
    if (!cashiers.has(id)) cashiers.set(id, { userId: id, sales: 0, total: 0, takings: zero() });
    return cashiers.get(id)!;
  };
  for (const p of o.payments) {
    if (p.status !== "succeeded" || !isDrawer(p.method)) continue;
    takings[p.method] += p.amountMinor;
    who(p.receivedBy).takings[p.method] += p.amountMinor;
    if (p.amountMinor < 0) refunds[p.method] -= p.amountMinor;
    else if (!p.saleId) repayments[p.method] += p.amountMinor;
  }
  let salesCount = 0, salesTotal = 0, voidedCount = 0, voidedTotal = 0, offlineCount = 0, creditGiven = 0, payerPortion = 0;
  for (const s of o.sales) {
    if (s.status === "voided") { voidedCount++; voidedTotal += s.totalMinor; continue; }
    salesCount++;
    salesTotal += s.totalMinor;
    creditGiven += s.creditMinor;
    payerPortion += s.payerPortionMinor;
    if (s.offline) offlineCount++;
    const c = who(s.cashierId);
    c.sales++;
    c.total += s.totalMinor;
  }
  for (const e of o.expenses) if (isDrawer(e.method)) expenses[e.method] += e.amountMinor;
  const expected = zero();
  for (const m of DRAWER_METHODS) expected[m] = takings[m] - expenses[m];
  const sum = (b: ByMethod) => DRAWER_METHODS.reduce((a, m) => a + b[m], 0);
  return {
    takings, refunds, repayments, expenses, expected, salesCount, salesTotal, voidedCount, voidedTotal, offlineCount, creditGiven, payerPortion,
    repaymentTotal: sum(repayments), expenseTotal: sum(expenses),
    perCashier: [...cashiers.values()].sort((a, b) => b.total - a.total),
  };
}

/** Counted minus expected: negative = short, positive = over. */
export const variance = (counted: number, expected: number) => counted - expected;
