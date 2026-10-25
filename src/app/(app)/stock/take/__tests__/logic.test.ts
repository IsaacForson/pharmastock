import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { branches, controlledRegister, products, stockBatches, stockMovements, stockTakes } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { adjustBatch, receiveIntoBatch } from "@/lib/stock";
import { cancelTake, completeTake, recordCount, startTake, varianceReport } from "../logic";

let ctx: Ctx;
let para: string, cd: string;
const batches: Record<string, string> = {};
const w = <T,>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ctx.tenant.id, fn);

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Take Test", country: "GH", ownerName: "Ama", email: `take-${Date.now()}@test.local`, password: "correct horse battery" });
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  await w(async (t) => {
    para = (await t.insert(products).values({ tenantId: tenant.id, name: "Paracetamol", baseUnit: "tablet" }).returning())[0].id;
    cd = (await t.insert(products).values({ tenantId: tenant.id, name: "Morphine", schedule: "controlled", baseUnit: "ampoule" }).returning())[0].id;
    batches.a = (await receiveIntoBatch(t, ctx, { productId: para, branchId: branch.id, qty: 100, batchNo: "A", expiry: "2030-01-01", unitCostMinor: 10 })).id;
    batches.b = (await receiveIntoBatch(t, ctx, { productId: para, branchId: branch.id, qty: 50, batchNo: "B", expiry: "2031-01-01", unitCostMinor: 12 })).id;
    batches.m = (await receiveIntoBatch(t, ctx, { productId: cd, branchId: branch.id, qty: 10, batchNo: "M", expiry: "2030-06-01", unitCostMinor: 500 })).id;
  });
});
afterAll(async () => { await purgeTenant(ctx.tenant.id); });

const qty = (id: string) => w(async (t) => (await t.select().from(stockBatches).where(eq(stockBatches.id, id)))[0].qtyOnHand);

describe("stock take", () => {
  it("partial: snapshots expected at first count, keeps later sales, records found stock", async () => {
    const take = await w((t) => startTake(t, ctx, { scope: "partial" }));
    await w((t) => recordCount(t, ctx, take.id, { productId: para, batchId: batches.a, countedQty: 90 }));
    await w((t) => adjustBatch(t, ctx, { batchId: batches.a, delta: -5, reason: "sale after count" })); // 95 left
    const line = await w((t) => recordCount(t, ctx, take.id, { productId: para, batchId: batches.a, countedQty: 92 })); // recount
    expect([line.expectedQty, line.countedQty]).toEqual([100, 92]);
    await w((t) => recordCount(t, ctx, take.id, { productId: para, batchNo: "new1", expiry: "2032-02-01", countedQty: 7 }));
    await w((t) => recordCount(t, ctx, take.id, { productId: cd, batchId: batches.m, countedQty: 9 }));
    const r = (await w((t) => varianceReport(t, take.id)))!;
    expect(r.lines.map((l) => [l.batchNo, l.variance, l.varianceMinor]).sort()).toEqual([["A", -8, -80], ["M", -1, -500], ["NEW1", 7, 84]].sort());
    expect(r.uncounted).toEqual([]);
    const s = await w((t) => completeTake(t, ctx, take.id, { zeroUncounted: false }));
    expect(s).toMatchObject({ adjusted: 2, found: 1, zeroed: 0 });
    expect(await qty(batches.a)).toBe(87); // 95 − 8
    expect(await qty(batches.b)).toBe(50); // untouched by a partial take
    await w(async (t) => {
      const [nb] = await t.select().from(stockBatches).where(eq(stockBatches.batchNo, "NEW1"));
      expect([nb.qtyOnHand, nb.unitCostMinor]).toEqual([7, 12]);
      const reg = await t.select().from(controlledRegister).where(eq(controlledRegister.productId, cd)).orderBy(controlledRegister.entryNo);
      expect(reg.at(-1)).toMatchObject({ kind: "adjusted", qtyOut: 1, balance: 9 });
      expect((await t.select().from(stockMovements).where(eq(stockMovements.ref, take.takeNo))).every((m) => m.type === "stocktake")).toBe(true);
    });
    await expect(w((t) => recordCount(t, ctx, take.id, { productId: para, batchId: batches.a, countedQty: 1 }))).rejects.toThrow(/already completed/);
  });

  it("full: refuses to zero uncounted batches without confirmation", async () => {
    const take = await w((t) => startTake(t, ctx, { scope: "full" }));
    await w((t) => recordCount(t, ctx, take.id, { productId: para, batchId: batches.a, countedQty: 87 }));
    const r = (await w((t) => varianceReport(t, take.id)))!;
    expect(r.uncounted.map((b) => b.batchNo).sort()).toEqual(["B", "M", "NEW1"]);
    await expect(w((t) => completeTake(t, ctx, take.id, { zeroUncounted: false }))).rejects.toThrow(/weren't counted/);
    await w((t) => recordCount(t, ctx, take.id, { productId: cd, batchId: batches.m, countedQty: 9 }));
    const s = await w((t) => completeTake(t, ctx, take.id, { zeroUncounted: true }));
    expect(s).toMatchObject({ adjusted: 0, zeroed: 2 });
    expect(await qty(batches.b)).toBe(0);
    expect(await qty(batches.a)).toBe(87);
  });

  it("cancels an open take without moving stock", async () => {
    const take = await w((t) => startTake(t, ctx, { scope: "partial" }));
    await w((t) => recordCount(t, ctx, take.id, { productId: para, batchId: batches.a, countedQty: 1 }));
    await w((t) => cancelTake(t, ctx, take.id));
    expect(await qty(batches.a)).toBe(87);
    expect((await w((t) => t.select().from(stockTakes).where(eq(stockTakes.id, take.id))))[0].status).toBe("cancelled");
  });
});
