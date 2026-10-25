import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOCS, journalInput } from "@/app/(app)/reports/accounting/data";
import { REPORTS, type Report } from "@/app/(app)/reports/queries";
import { resolveRange } from "@/app/(app)/reports/range";
import { adminDb, withTenant } from "@/db";
import { branches, customers, expenses, goodsReceipts, priceChanges, productUnits, products, saleLines, suppliers } from "@/db/schema";
import { ask, runTool, TOOLS, type AskEvent, type Chat, type ChatResponse } from "@/lib/ai-ask";
import { buildJournal } from "@/lib/analytics";
import type { Ctx } from "@/lib/auth";
import { addDays, localDay } from "@/lib/format";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { createSale, returnSale } from "@/lib/sales";
import { adjustBatch, receiveIntoBatch } from "@/lib/stock";

let ctx: Ctx;
let today: string;

beforeAll(async () => {
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Reports Test Pharmacy", country: "GH", ownerName: "Ama", email: `reports-${Date.now()}@test.local`, password: "correct horse battery" });
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  today = localDay(tenant.timezone);
  await withTenant(tenant.id, async (t) => {
    const [sup] = await t.insert(suppliers).values({ tenantId: tenant.id, name: "Kama" }).returning();
    const [p] = await t.insert(products).values({ tenantId: tenant.id, name: "Paracetamol", strength: "500 mg", baseUnit: "tablet", taxBp: 0 }).returning();
    const [u] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: p.id, name: "strip of 10", factor: 10, sellPriceMinor: 200, isDefault: true }).returning();
    const [v] = await t.insert(products).values({ tenantId: tenant.id, name: "Vitamin C", baseUnit: "bottle", taxBp: 1500 }).returning();
    const [vu] = await t.insert(productUnits).values({ tenantId: tenant.id, productId: v.id, name: "bottle", factor: 1, sellPriceMinor: 1150 }).returning();
    const [dead] = await t.insert(products).values({ tenantId: tenant.id, name: "Old Syrup", baseUnit: "bottle" }).returning();
    await receiveIntoBatch(t, ctx, { productId: p.id, branchId: branch.id, qty: 100, batchNo: "P1", expiry: addDays(today, 300), unitCostMinor: 10, supplierId: sup.id });
    await receiveIntoBatch(t, ctx, { productId: v.id, branchId: branch.id, qty: 10, batchNo: "V1", expiry: addDays(today, 20), unitCostMinor: 500 });
    const old = await receiveIntoBatch(t, ctx, { productId: dead.id, branchId: branch.id, qty: 4, batchNo: "", expiry: null, unitCostMinor: 300 });
    await adjustBatch(t, ctx, { batchId: old.id, delta: -1, reason: "Broken", type: "damage" });
    const [c] = await t.insert(customers).values({ tenantId: tenant.id, customerNo: "C-1", name: "Kofi", creditLimitMinor: 10_000, loyaltyPoints: 50 }).returning();
    await createSale(t, ctx, { clientId: "rep-sale-0001", lines: [{ productId: p.id, unitId: u.id, qty: 3 }], payments: [{ method: "cash", amountMinor: 1000 }] } as never);
    const s2 = await createSale(t, ctx, { clientId: "rep-sale-0002", customerId: c.id, lines: [{ productId: v.id, unitId: vu.id, qty: 2 }], payments: [{ method: "mobile_money", amountMinor: 1300 }], creditMinor: 1000 } as never);
    const [line] = await t.select().from(saleLines).where(eq(saleLines.saleId, s2.id));
    await returnSale(t, ctx, { saleId: s2.id, lines: [{ saleLineId: line.id, baseQty: 1 }], reason: "Changed mind", restock: true, refundMethod: "cash" });
    await t.insert(priceChanges).values({ tenantId: tenant.id, productId: p.id, unitId: u.id, oldPriceMinor: 180, newPriceMinor: 200 });
    await t.insert(expenses).values({ tenantId: tenant.id, branchId: branch.id, category: "Rent", amountMinor: 5000, day: today });
    await t.insert(goodsReceipts).values({ tenantId: tenant.id, branchId: branch.id, supplierId: sup.id, grnNo: "GRN-1", totalMinor: 1000, paidMinor: 0 });
  });
});

afterAll(async () => { await purgeTenant(ctx.tenant.id); });

const args = () => ({ ctx, range: resolveRange({ preset: "last30" }, ctx.tenant.timezone), branches: [ctx.branchId], today, days: 90 });

describe("reports", () => {
  it("every report runs", async () => {
    for (const [name, r] of Object.entries(REPORTS) as [string, Report][]) {
      const rows = await withTenant(ctx.tenant.id, (t) => r.run(t, args())).catch((e) => { throw new Error(`${name}: ${(e as Error).message}`); });
      expect(Array.isArray(rows), name).toBe(true);
    }
  });

  it("computes margin after returns and the tax split", async () => {
    const m = await withTenant(ctx.tenant.id, (t) => REPORTS["margin-product"].run(t, args()));
    const para = m.find((r) => String(r.product).startsWith("Paracetamol"))!;
    expect(para).toMatchObject({ units: 30, revenue: 600, cost: 300, margin: 300, marginPct: 50 });
    const vit = m.find((r) => r.product === "Vitamin C")!;
    expect(vit).toMatchObject({ units: 1, revenue: 1000, cost: 500 }); // 1150 incl. 15% tax = 1000 net; one of two returned
    const tax = await withTenant(ctx.tenant.id, (t) => REPORTS.tax.run(t, args()));
    expect(tax.map((r) => [r.rate, r.tax])).toEqual([["0%", 0], ["15%", 150]]);
  });

  it("finds dead stock, near expiry and batch capture", async () => {
    const dead = await withTenant(ctx.tenant.id, (t) => REPORTS["dead-stock"].run(t, { ...args(), days: 0, today: addDays(today, 1) }));
    expect(dead.map((r) => r.product)).toContain("Old Syrup");
    const near = await withTenant(ctx.tenant.id, (t) => REPORTS["near-expiry"].run(t, args()));
    expect(near.map((r) => r.product)).toEqual(["Vitamin C"]);
    const cap = await withTenant(ctx.tenant.id, (t) => REPORTS["batch-capture"].run(t, args()));
    expect(cap[0]).toMatchObject({ batches: 3, captured: 2 });
  });

  it("builds a balanced journal and every accounting file", async () => {
    const range = resolveRange({ preset: "last30" }, ctx.tenant.timezone);
    const a = { range, branches: [ctx.branchId], all: true, tz: ctx.tenant.timezone };
    const j = buildJournal(await withTenant(ctx.tenant.id, (t) => journalInput(t, a)));
    expect(j.reduce((s, r) => s + r.debit, 0)).toBe(j.reduce((s, r) => s + r.credit, 0));
    expect(j.find((r) => r.account === "Expenses: Rent")).toMatchObject({ debit: 5000 });
    for (const [name, d] of Object.entries(DOCS)) {
      const csv = await withTenant(ctx.tenant.id, (t) => d.csv(t, a));
      expect(csv.split("\r\n").length, name).toBeGreaterThan(1);
    }
  });
});

describe("ask tools", () => {
  const scope = () => ({ tenant: ctx.tenant, branches: ctx.branches, canSeeCost: true, today });
  it("every tool runs read-only against the tenant", async () => {
    const inputs: Record<string, unknown> = {
      reorder_list: {}, expiring_batches: { within_days: 60, include_expired: true }, sales_by_product: { product: "para", from: addDays(today, -7), to: today },
      sales_by_day: { from: addDays(today, -7), to: today }, stock_on_hand: { product: "vitamin" }, dead_stock: { days_without_sales: 30 }, price_changes: { product: "paracetamol" },
    };
    expect(TOOLS.map((t) => t.function.name).sort()).toEqual(Object.keys(inputs).sort());
    for (const [name, input] of Object.entries(inputs)) {
      const out = await withTenant(ctx.tenant.id, (t) => runTool(t, scope(), name, input));
      expect(JSON.stringify(out), name).not.toMatch(/"error"/);
    }
    const sales = await withTenant(ctx.tenant.id, (t) => runTool(t, scope(), "sales_by_product", { product: "para", from: addDays(today, -7), to: today })) as { rows: { units: number }[] };
    expect(sales.rows[0].units).toBe(30);
    const noCost = await withTenant(ctx.tenant.id, (t) => runTool(t, { ...scope(), canSeeCost: false }, "sales_by_product", { from: today, to: today })) as { rows: object[]; note: string };
    expect(JSON.stringify(noCost.rows)).not.toMatch(/margin/);
    await expect(withTenant(ctx.tenant.id, (t) => runTool(t, scope(), "expiring_batches", { within_days: "lots" }))).rejects.toThrow();
  });

  it("runs the tool loop, reports progress and stops at the answer", async () => {
    const replies: ChatResponse[] = [
      { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "stock_on_hand", arguments: JSON.stringify({ product: "vitamin" }) } }] } }] },
      { choices: [{ finish_reason: "stop", message: { content: "You have **9** Vitamin C." } }] },
    ];
    const seen: unknown[] = [];
    const fake: Chat = async (req) => { seen.push(req.messages.at(-1)); return replies.shift()!; };
    const events: AskEvent[] = [];
    const used = await ask("How much vitamin C?", scope(), (fn) => withTenant(ctx.tenant.id, fn), (e) => events.push(e), fake);
    expect(used).toEqual(["stock_on_hand"]);
    expect(events.map((e) => e.type)).toEqual(["tool", "answer"]);
    expect(JSON.stringify(seen[1])).toMatch(/Vitamin C/); // tool result fed back
    expect(seen[1]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });

  it("feeds bad tool arguments back to the model instead of failing", async () => {
    const replies: ChatResponse[] = [
      { choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "expiring_batches", arguments: "{not json" } }] } }] },
      { choices: [{ finish_reason: "stop", message: { content: "Sorry, try again." } }] },
    ];
    const seen: { content?: unknown }[] = [];
    const used = await ask("x?", scope(), (fn) => withTenant(ctx.tenant.id, fn), () => {}, async (req) => { seen.push(req.messages.at(-1) as never); return replies.shift()!; });
    expect(used).toEqual(["expiring_batches"]);
    expect(seen[1].content).toMatch(/not valid JSON/);
  });
});
