import { describe, expect, it } from "vitest";
import { summarizeDay, variance } from "@/lib/cashup";

describe("daily close", () => {
  it("nets refunds, ignores voided payments and non-drawer methods, and subtracts expenses", () => {
    const s = summarizeDay({
      payments: [
        { method: "cash", amountMinor: 5000, status: "succeeded", saleId: "s1", receivedBy: "u1" },
        { method: "mobile_money", amountMinor: 3000, status: "succeeded", saleId: "s2", receivedBy: "u2" },
        { method: "cash", amountMinor: 2000, status: "refunded", saleId: "s3", receivedBy: "u1" }, // voided sale
        { method: "cash", amountMinor: -700, status: "succeeded", saleId: "s1", receivedBy: "u1" }, // return refund
        { method: "cash", amountMinor: 1000, status: "succeeded", saleId: null, receivedBy: "u1" }, // repayment
        { method: "loyalty", amountMinor: 100, status: "succeeded", saleId: "s1", receivedBy: "u1" },
        { method: "insurance", amountMinor: 4000, status: "succeeded", saleId: "s4", receivedBy: "u1" },
      ],
      sales: [
        { status: "completed", totalMinor: 5100, creditMinor: 0, payerPortionMinor: 0, cashierId: "u1" },
        { status: "partially_returned", totalMinor: 6000, creditMinor: 3000, payerPortionMinor: 0, cashierId: "u2", offline: true },
        { status: "voided", totalMinor: 2000, creditMinor: 0, payerPortionMinor: 0, cashierId: "u1" },
      ],
      expenses: [{ method: "cash", amountMinor: 800 }, { method: "bank", amountMinor: 5000 }],
    });
    expect(s.takings).toEqual({ cash: 5300, mobile_money: 3000, card: 0, bank: 0 });
    expect(s.refunds.cash).toBe(700);
    expect(s.repayments.cash).toBe(1000);
    expect(s.expected.cash).toBe(4500);
    expect(s.expected.bank).toBe(-5000);
    expect([s.salesCount, s.salesTotal, s.voidedCount, s.creditGiven, s.offlineCount]).toEqual([2, 11100, 1, 3000, 1]);
    expect(s.perCashier.find((c) => c.userId === "u1")?.takings.cash).toBe(5300);
    expect(variance(4400, s.expected.cash)).toBe(-100);
  });
});
