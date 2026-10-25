import { describe, expect, it } from "vitest";
import { syncBody } from "./ops";

const user = "11111111-1111-4111-8111-111111111111";
const uuid = "22222222-2222-4222-8222-222222222222";
const sale = { id: 1, userId: user, type: "sale", totalMinor: 300, input: { clientId: "till-abc-12345678", lines: [{ productId: uuid, unitId: uuid, qty: 2 }], payments: [{ method: "cash", amountMinor: 500 }], soldAt: "2026-10-25T09:00:00.000Z" } };
const repayment = { id: 2, userId: user, type: "repayment", clientId: "till-rp-12345678", customerId: uuid, amountMinor: 2500, method: "mobile_money", reference: "MOMO123" };

describe("offline sync op validation", () => {
  it("accepts valid sale and repayment ops in order, filling sale defaults", () => {
    const r = syncBody.safeParse({ ops: [sale, repayment] });
    expect(r.success).toBe(true);
    expect(r.data?.ops.map((o) => o.type)).toEqual(["sale", "repayment"]);
    const s = r.data!.ops[0];
    expect(s.type === "sale" && s.input.creditMinor).toBe(0);
  });
  it("rejects unknown op types and clinic leftovers", () => {
    expect(syncBody.safeParse({ ops: [{ ...sale, type: "visit.note" }] }).success).toBe(false);
    expect(syncBody.safeParse({ ops: [{ ...repayment, type: "payment" }] }).success).toBe(false);
  });
  it("rejects bad money, quantities and identifiers", () => {
    for (const bad of [{ amountMinor: 0 }, { amountMinor: -100 }, { amountMinor: 12.5 }, { method: "loyalty" }, { customerId: "x" }, { clientId: "short" }, { userId: undefined }]) {
      expect(syncBody.safeParse({ ops: [{ ...repayment, ...bad }] }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(syncBody.safeParse({ ops: [{ ...sale, input: { ...sale.input, lines: [] } }] }).success).toBe(false);
    expect(syncBody.safeParse({ ops: [{ ...sale, input: { ...sale.input, lines: [{ productId: uuid, unitId: uuid, qty: -1 }] } }] }).success).toBe(false);
  });
  it("bounds the batch", () => {
    expect(syncBody.safeParse({ ops: [] }).success).toBe(false);
    expect(syncBody.safeParse({ ops: Array.from({ length: 101 }, (_, i) => ({ ...repayment, id: i })) }).success).toBe(false);
  });
});
