import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { alerts, branches, controlledRegister, products, stockBatches, transferLines, transfers } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { onHand, receiveIntoBatch } from "@/lib/stock";
import { quarantineAlertBatch, writeOffAlert } from "../../alerts/logic";
import { cancelTransfer, receiveTransfer, sendTransfer } from "../logic";

let ctx: Ctx, main: string, east: string, para: string, cd: string;
const at = (branchId: string): Ctx => ({ ...ctx, branchId });
const run = <T,>(fn: (t: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) => withTenant(ctx.tenant.id, fn);

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Transfer Test", country: "GH", ownerName: "Ama", email: `trf-${Date.now()}@test.local`, password: "correct horse battery" });
  const [b] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  const [e] = await adminDb().insert(branches).values({ tenantId: tenant.id, name: "East" }).returning();
  main = b.id; east = e.id;
  ctx = { user: owner, tenant, sessionId: "t", branchId: main, branches: [{ id: main, name: "Main" }, { id: east, name: "East" }], access: "full", ip: null, impersonatedBy: null };
  await run(async (t) => {
    [{ id: para }] = await t.insert(products).values({ tenantId: tenant.id, name: "Paracetamol", baseUnit: "tablet" }).returning();
    [{ id: cd }] = await t.insert(products).values({ tenantId: tenant.id, name: "Morphine", schedule: "controlled", baseUnit: "ampoule" }).returning();
    await receiveIntoBatch(t, ctx, { productId: para, branchId: main, qty: 10, batchNo: "A", expiry: "2027-01-01", unitCostMinor: 5 });
    await receiveIntoBatch(t, ctx, { productId: para, branchId: main, qty: 20, batchNo: "B", expiry: "2028-01-01", unitCostMinor: 7 });
    await receiveIntoBatch(t, ctx, { productId: cd, branchId: main, qty: 4, batchNo: "M", expiry: "2020-01-01", unitCostMinor: 100 });
  });
});
afterAll(async () => { await purgeTenant(ctx.tenant.id); });

describe("transfers", () => {
  it("sends FEFO, receives short with a discrepancy alert, keeping batch and cost", async () => {
    const tr = await run((t) => sendTransfer(t, ctx, { toBranchId: east, lines: [{ productId: para, qty: 15 }] }));
    expect(tr.transferNo).toMatch(/^TRF-/);
    expect(await run((t) => onHand(t, para, main))).toBe(15);
    const lines = await run((t) => t.select().from(transferLines).where(eq(transferLines.transferId, tr.id)));
    expect(lines.map((l) => l.qty).sort()).toEqual([10, 5]);
    await expect(run((t) => receiveTransfer(t, ctx, { id: tr.id, received: {} }))).rejects.toThrow(/receiving branch/);
    const bLine = lines.find((l) => l.qty === 5)!;
    await expect(run((t) => receiveTransfer(t, at(east), { id: tr.id, received: { [bLine.id]: 3 } }))).rejects.toThrow(/short/);
    expect(await run((t) => receiveTransfer(t, at(east), { id: tr.id, received: { [bLine.id]: 3 }, shortReason: "2 broken" }))).toEqual({ shortQty: 2 });
    const got = await run((t) => t.select().from(stockBatches).where(eq(stockBatches.branchId, east)));
    expect(got.map((b) => [b.batchNo, b.qtyOnHand, b.unitCostMinor, b.expiry]).sort()).toEqual([["A", 10, 5, "2027-01-01"], ["B", 3, 7, "2028-01-01"]]);
    const [al] = await run((t) => t.select().from(alerts).where(eq(alerts.dedupeKey, `transfer_short:${tr.id}`)));
    expect(al).toMatchObject({ kind: "stock_discrepancy", branchId: east, valueMinor: 14 });
    await expect(run((t) => cancelTransfer(t, ctx, { id: tr.id }))).rejects.toThrow(/already received/);
  });

  it("sends a picked batch and cancel puts it back", async () => {
    const [b] = await run((t) => t.select().from(stockBatches).where(eq(stockBatches.batchNo, "B")).then((r) => r.filter((x) => x.branchId === main)));
    const tr = await run((t) => sendTransfer(t, ctx, { toBranchId: east, lines: [{ productId: para, qty: 4, batchId: b.id }] }));
    expect(await run((t) => onHand(t, para, main))).toBe(11);
    await run((t) => cancelTransfer(t, ctx, { id: tr.id, reason: "wrong branch" }));
    expect(await run((t) => onHand(t, para, main))).toBe(15);
    const [x] = await run((t) => t.select().from(transfers).where(eq(transfers.id, tr.id)));
    expect(x.status).toBe("cancelled");
  });

  it("refuses expired or quarantined batches", async () => {
    const [m] = await run((t) => t.select().from(stockBatches).where(eq(stockBatches.productId, cd)));
    await expect(run((t) => sendTransfer(t, ctx, { toBranchId: east, lines: [{ productId: cd, qty: 1, batchId: m.id }] }))).rejects.toThrow(/expired/);
  });
});

describe("alert actions", () => {
  it("quarantines and writes off a controlled batch only with a witness", async () => {
    const [m] = await run((t) => t.select().from(stockBatches).where(eq(stockBatches.productId, cd)));
    const [a] = await run((t) => t.insert(alerts).values({ tenantId: ctx.tenant.id, branchId: main, kind: "expired", productId: cd, batchId: m.id, title: "Morphine expired", dedupeKey: `expired:${m.id}` }).returning());
    await run((t) => quarantineAlertBatch(t, ctx, { id: a.id }));
    expect((await run((t) => t.select().from(stockBatches).where(eq(stockBatches.id, m.id))))[0]).toMatchObject({ quarantined: true, qtyOnHand: 4 });
    await expect(run((t) => writeOffAlert(t, ctx, { id: a.id }))).rejects.toThrow(/witness/);
    expect(await run((t) => writeOffAlert(t, ctx, { id: a.id, witnessName: "Kofi" }))).toEqual({ qty: 4 });
    const reg = await run((t) => t.select().from(controlledRegister).where(eq(controlledRegister.productId, cd)).orderBy(controlledRegister.entryNo));
    expect(reg.at(-1)).toMatchObject({ kind: "destroyed", qtyOut: 4, balance: 0, witnessName: "Kofi" });
    const [after] = await run((t) => t.select().from(alerts).where(eq(alerts.id, a.id)));
    expect(after).toMatchObject({ status: "done", resolution: "written_off" });
  });
});
