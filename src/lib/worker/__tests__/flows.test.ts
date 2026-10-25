import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb, withTenant } from "@/db";
import { alerts, auditLog, branches, customers, jobs, messageLog, prescriptionItems, prescriptions, products, productUnits, recalls, stockBatches, suppliers, tenants } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { addDays, localDay } from "@/lib/format";
import { purgeTenant, provisionTenant } from "@/lib/provision";
import { adjustBatch, receiveIntoBatch } from "@/lib/stock";
import { dailyTenant, ownerSummary, scheduleRecurring } from "../daily";
import { handleInbound } from "../inbound";

let ctx: Ctx;
let today: string;
const b: Record<string, string> = {};
let recallId: string, customerId: string, rxId: string;
const phone = `+23324${String(Date.now()).slice(-7)}`;

beforeAll(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {}); // dev-log "sends"
  const { tenant, owner } = await provisionTenant({ pharmacyName: "Alerts Test Pharmacy", country: "GH", ownerName: "Ama", email: `alerts-${Date.now()}@test.local`, password: "correct horse battery" });
  await adminDb().update(tenants).set({ ownerSummaryTo: "+233200000001" }).where(eq(tenants.id, tenant.id));
  const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
  ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
  today = localDay(tenant.timezone);
  await withTenant(tenant.id, async (t) => {
    const [sup] = await t.insert(suppliers).values({ tenantId: tenant.id, name: "Kama Distributors", returnMinDaysToExpiry: 30 }).returning();
    const [para] = await t.insert(products).values({ tenantId: tenant.id, name: "Panadol Extra", genericName: "Paracetamol", manufacturer: "GSK", strength: "500 mg", baseUnit: "tablet" }).returning();
    await t.insert(productUnits).values({ tenantId: tenant.id, productId: para.id, name: "tablet", factor: 1, sellPriceMinor: 20 });
    const add = async (no: string, days: number, qty: number, productId = para.id) =>
      (b[no] = (await receiveIntoBatch(t, ctx, { productId, branchId: branch.id, qty, batchNo: no, expiry: addDays(today, days), unitCostMinor: 10, supplierId: sup.id })).id);
    await add("FAR", 400, 100);
    await add("SOON", 40, 40);
    await add("OLD", -5, 10);
    const [amox] = await t.insert(products).values({ tenantId: tenant.id, name: "Amoxil", genericName: "Amoxicillin", strength: "250 mg", baseUnit: "capsule", reorderLevel: 20 }).returning();
    await t.insert(productUnits).values({ tenantId: tenant.id, productId: amox.id, name: "capsule", factor: 1, sellPriceMinor: 50 });
    await add("AMX", 500, 5, amox.id);
    const [c] = await t.insert(customers).values({ tenantId: tenant.id, customerNo: "C-1", name: "Kofi Mensah", phone, messagingConsent: true, preferredChannel: "sms" }).returning();
    customerId = c.id;
    const [rx] = await t.insert(prescriptions).values({ tenantId: tenant.id, branchId: branch.id, rxNo: "RX-1", customerId, prescriberName: "Dr Owusu", issuedOn: today, refillsAllowed: 3, refillIntervalDays: 30, nextRefillDue: addDays(today, 2) }).returning();
    rxId = rx.id;
    await t.insert(prescriptionItems).values({ tenantId: tenant.id, prescriptionId: rx.id, drugName: "Amlodipine 5 mg" });
  });
  [{ id: recallId }] = await adminDb().insert(recalls).values({ country: "GH", productName: "Panadol Extra", manufacturer: "GSK Ghana Ltd", batchNos: ["far"], reason: "Contamination", publishedOn: today }).returning({ id: recalls.id });
});

afterAll(async () => {
  await purgeTenant(ctx.tenant.id);
  await adminDb().delete(recalls).where(eq(recalls.id, recallId));
  await adminDb().delete(jobs).where(and(eq(jobs.type, "billing.sweep"), eq(jobs.status, "pending")));
  vi.restoreAllMocks();
});

const openAlerts = () => adminDb().select().from(alerts).where(and(eq(alerts.tenantId, ctx.tenant.id), eq(alerts.status, "open")));

describe("nightly alerts engine", () => {
  it("raises expiry, expired, return-window, low-stock, recall and refill alerts, idempotently", async () => {
    const first = await dailyTenant(ctx.tenant.id);
    const second = await dailyTenant(ctx.tenant.id);
    expect(first!.raised).toBeGreaterThan(0);
    expect(second!.raised).toBe(0);
    const open = await openAlerts();
    const keys = open.map((a) => a.dedupeKey.split(":")[0]).sort();
    expect(keys).toEqual(["exp60", "expired", "low", "recall", "refill", "retwin"]);
    const soon = open.find((a) => a.kind === "expiry_60")!;
    expect(soon.batchId).toBe(b.SOON);
    expect(soon.valueMinor).toBe(400);
    expect(soon.detail).toMatch(/Suggested: Return to the supplier/);
    expect(open.find((a) => a.kind === "low_stock")!.title).toMatch(/Amoxil/);
  });

  it("quarantines recalled batches once, with an audit entry", async () => {
    const [far] = await adminDb().select().from(stockBatches).where(eq(stockBatches.id, b.FAR));
    expect(far.quarantined).toBe(true);
    expect(far.quarantineReason).toMatch(/Recall: Contamination/);
    const log = await adminDb().select().from(auditLog).where(and(eq(auditLog.tenantId, ctx.tenant.id), eq(auditLog.action, "quarantine")));
    expect(log).toHaveLength(1);
    // A pharmacist releases it (false match) and dismisses the alert: the next run must not re-quarantine.
    await adminDb().update(stockBatches).set({ quarantined: false }).where(eq(stockBatches.id, b.FAR));
    await adminDb().update(alerts).set({ status: "dismissed" }).where(and(eq(alerts.tenantId, ctx.tenant.id), eq(alerts.kind, "recall")));
    await dailyTenant(ctx.tenant.id);
    const [again] = await adminDb().select().from(stockBatches).where(eq(stockBatches.id, b.FAR));
    expect(again.quarantined).toBe(false);
    expect((await openAlerts()).some((a) => a.kind === "recall")).toBe(false);
  });

  it("queues one consent-checked refill reminder", async () => {
    const msgs = await adminDb().select().from(messageLog).where(and(eq(messageLog.tenantId, ctx.tenant.id), eq(messageLog.purpose, "refill")));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toMatch(/Amlodipine 5 mg/);
  });

  it("closes batch alerts once the batch is written off", async () => {
    await withTenant(ctx.tenant.id, (t) => adjustBatch(t, ctx, { batchId: b.OLD, delta: -10, reason: "Expired", type: "expire" }));
    await dailyTenant(ctx.tenant.id);
    const [a] = await adminDb().select().from(alerts).where(and(eq(alerts.tenantId, ctx.tenant.id), eq(alerts.kind, "expired")));
    expect(a).toMatchObject({ status: "done", resolution: "written_off" });
  });
});

describe("inbound replies", () => {
  it("a 1 after a refill reminder raises a refill request alert", async () => {
    expect(await handleInbound({ channel: "sms", from: phone, text: "1", provider: "test", providerId: `in-${Date.now()}` })).toMatchObject({ status: "ok", command: "refill" });
    const [a] = await adminDb().select().from(alerts).where(and(eq(alerts.tenantId, ctx.tenant.id), eq(alerts.dedupeKey, `refillreq:${rxId}:${addDays(today, 2)}`)));
    expect(a.title).toBe("Kofi Mensah asked for a refill");
    const inbound = await adminDb().select().from(messageLog).where(and(eq(messageLog.customerId, customerId), eq(messageLog.direction, "in")));
    expect(inbound).toHaveLength(1);
  });
  it("STOP opts the customer out; unknown senders are ignored", async () => {
    await handleInbound({ channel: "whatsapp", from: phone.slice(1), text: "STOP", provider: "test" });
    const [c] = await adminDb().select().from(customers).where(eq(customers.id, customerId));
    expect(c.optedOutAt).not.toBeNull();
    expect(await handleInbound({ channel: "sms", from: "+10000000000", text: "1", provider: "test" })).toEqual({ status: "unknown_sender" });
  });
});

describe("scheduling and owner summary", () => {
  it("schedules one nightly sweep and one owner summary per day", async () => {
    await scheduleRecurring();
    await scheduleRecurring();
    const js = await adminDb().select().from(jobs).where(and(eq(jobs.tenantId, ctx.tenant.id), inArray(jobs.type, ["daily.tenant", "owner.summary"])));
    expect(js.map((j) => j.type).sort()).toEqual(["daily.tenant", "owner.summary"]);
  });
  it("queues the owner summary once per day", async () => {
    await ownerSummary(ctx.tenant.id, today);
    await ownerSummary(ctx.tenant.id, today);
    const msgs = await adminDb().select().from(messageLog).where(and(eq(messageLog.tenantId, ctx.tenant.id), eq(messageLog.purpose, "operations")));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ to: "+233200000001", channel: "whatsapp", templateKey: "owner_summary" });
    expect(msgs[0].body).toMatch(/Alerts Test Pharmacy/);
    expect(msgs[0].body).toMatch(/Near expiry \(90 days\)/);
  });
  it("sends nothing and schedules nothing when the owner switches the summary off", async () => {
    await adminDb().update(tenants).set({ ownerSummaryEnabled: false }).where(eq(tenants.id, ctx.tenant.id));
    await adminDb().delete(jobs).where(and(eq(jobs.tenantId, ctx.tenant.id), eq(jobs.type, "owner.summary")));
    await scheduleRecurring();
    const js = await adminDb().select().from(jobs).where(and(eq(jobs.tenantId, ctx.tenant.id), eq(jobs.type, "owner.summary")));
    expect(js).toHaveLength(0);
    expect(await ownerSummary(ctx.tenant.id, addDays(today, 1))).toBeNull(); // a job queued before switching off does nothing
    await adminDb().update(tenants).set({ ownerSummaryEnabled: true }).where(eq(tenants.id, ctx.tenant.id));
  });
});
