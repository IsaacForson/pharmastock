import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import * as schema from "@/db/schema";
import { ApiError, authenticate, newApiKey, RATE_LIMIT, rateLimited } from "@/lib/api-auth";
import { addDays, localDay } from "@/lib/format";
import { provisionTenant, purgeTenant } from "@/lib/provision";
import { receiveIntoBatch } from "@/lib/stock";
import { GET as listCustomers, POST as createCustomer } from "../customers/route";
import { GET as getCustomer } from "../customers/[id]/route";
import { GET as specRoute } from "../openapi.json/route";
import { GET as listProducts, POST as createProduct } from "../products/route";
import { PATCH as patchProduct } from "../products/[id]/route";
import { GET as listRecalls } from "../recalls/route";
import { GET as listSales, POST as createSale } from "../sales/route";
import { GET as getSale } from "../sales/[id]/route";
import { GET as stockLevels } from "../stock/route";
import { GET as stockBatches } from "../stock/batches/route";

const db = () => adminDb();
let chain: string, pro: string, other: string, full: string, readOnly: string, revoked: string, proKey: string, otherCustomer: string;
let ownerId: string;

const req = (key: string | null, url: string, init: RequestInit = {}) =>
  new Request(`http://x/api/v1${url}`, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" } });
const json = async (r: Response) => ({ status: r.status, body: await r.json() });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function tenant(name: string, plan: "pro" | "chain") {
  const { tenant: t, owner } = await provisionTenant({ pharmacyName: name, country: "GH", ownerName: "Owner", email: `${name}-${Date.now()}@test.local`, password: "correct horse battery" });
  await db().update(schema.tenants).set({ plan, planStatus: "active" }).where(eq(schema.tenants.id, t.id));
  return { id: t.id, owner: owner.id };
}
async function key(tenantId: string, scopes: string[], createdBy: string | null, revokedAt?: Date) {
  const k = newApiKey();
  await db().insert(schema.apiKeys).values({ tenantId, name: "test", prefix: k.prefix, keyHash: k.keyHash, scopes, revokedAt, createdBy });
  return k.key;
}

beforeAll(async () => {
  const c = await tenant("api-chain", "chain");
  chain = c.id; ownerId = c.owner;
  pro = (await tenant("api-pro", "pro")).id;
  other = (await tenant("api-other", "chain")).id;
  full = await key(chain, ["products:read", "products:write", "stock:read", "sales:read", "sales:write", "customers:read", "customers:write", "recalls:read"], ownerId);
  readOnly = await key(chain, ["products:read"], ownerId);
  revoked = await key(chain, ["products:read"], ownerId, new Date());
  proKey = await key(pro, ["products:read"], null);
  [{ id: otherCustomer }] = await db().insert(schema.customers).values({ tenantId: other, customerNo: "C-000001", name: "Other Pharmacy Customer" }).returning({ id: schema.customers.id });
});
afterAll(async () => {
  for (const id of [chain, pro, other]) await purgeTenant(id);
});

const status = (p: Promise<unknown>) => p.then(() => 200, (e) => (e instanceof ApiError ? e.status : 500));

describe("API key auth", () => {
  it("rejects missing, unknown and revoked keys", async () => {
    expect(await status(authenticate(req(null, "/products"), "products:read"))).toBe(401);
    expect(await status(authenticate(req("ps_live_nope", "/products"), "products:read"))).toBe(401);
    expect(await status(authenticate(req(revoked, "/products"), "products:read"))).toBe(401);
  });
  it("requires the Chain api feature and the scope", async () => {
    expect(await status(authenticate(req(proKey, "/products"), "products:read"))).toBe(403);
    expect(await status(authenticate(req(readOnly, "/products"), "products:write"))).toBe(403);
    expect(await status(authenticate(req(readOnly, "/products"), "products:read"))).toBe(200);
  });
  it("rate limits per key in a fixed window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(rateLimited("k-test", t0 + i)).toBe(false);
    expect(rateLimited("k-test", t0 + RATE_LIMIT)).toBe(true);
    expect(rateLimited("k-test", t0 + 60_000)).toBe(false);
  });
});

describe("API endpoints", () => {
  let productId: string, unitId: string;

  it("creates, lists and reprices products (price history recorded)", async () => {
    const created = await json(await createProduct(req(full, "/products", { method: "POST", body: JSON.stringify({
      name: "Panadol", genericName: "Paracetamol", strength: "500 mg", baseUnit: "tablet", taxBp: 0, units: [{ name: "strip of 10", factor: 10, sellPriceMinor: 150, isDefault: true, barcodes: ["600123"] }],
    }) })));
    expect(created.status).toBe(201);
    productId = created.body.id; unitId = created.body.units[0].id;
    expect(created.body.units[0]).toMatchObject({ factor: 10, barcodes: ["600123"] });
    const list = await json(await listProducts(req(full, "/products?q=parac")));
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([productId]);
    const patched = await json(await patchProduct(req(full, `/products/${productId}`, { method: "PATCH", body: JSON.stringify({ reorderLevel: 50, prices: [{ unitId, sellPriceMinor: 180 }] }) }), ctx(productId)));
    expect(patched.body).toMatchObject({ reorderLevel: 50, units: [{ sellPriceMinor: 180 }] });
    const pc = await db().select().from(schema.priceChanges).where(eq(schema.priceChanges.productId, productId));
    expect(pc).toMatchObject([{ oldPriceMinor: 150, newPriceMinor: 180 }]);
    expect((await json(await createProduct(req(full, "/products", { method: "POST", body: JSON.stringify({ name: "" }) })))).status).toBe(422);
  });

  it("records a sale idempotently through the sale engine and reads stock", async () => {
    const [branch] = await db().select().from(schema.branches).where(eq(schema.branches.tenantId, chain));
    const [owner] = await db().select().from(schema.users).where(eq(schema.users.id, ownerId));
    const [t] = await db().select().from(schema.tenants).where(eq(schema.tenants.id, chain));
    await withTenant(chain, (tx) => receiveIntoBatch(tx, { tenant: t, user: owner }, { productId, branchId: branch.id, qty: 100, batchNo: "B1", expiry: addDays(localDay(t.timezone), 200), unitCostMinor: 10 }));
    const body = JSON.stringify({ clientId: "api-sale-000001", lines: [{ productId, unitId, qty: 2 }], payments: [{ method: "cash", amountMinor: 400 }] });
    const first = await json(await createSale(req(full, "/sales", { method: "POST", body })));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ totalMinor: 360, changeMinor: 40, cashierId: ownerId, branchId: branch.id });
    const again = await json(await createSale(req(full, "/sales", { method: "POST", body })));
    expect(again).toMatchObject({ status: 200, body: { id: first.body.id } });
    const one = await json(await getSale(req(full, `/sales/${first.body.id}`), ctx(first.body.id)));
    expect(one.body.lines[0]).toMatchObject({ baseQty: 20, batches: [{ qty: 20 }] });
    expect(one.body.payments[0]).toMatchObject({ method: "cash", amountMinor: 360 });
    expect((await json(await listSales(req(full, "/sales")))).body.data).toHaveLength(1);
    const short = await json(await createSale(req(full, "/sales", { method: "POST", body: JSON.stringify({ clientId: "api-sale-000002", lines: [{ productId, unitId, qty: 99 }], payments: [{ method: "cash", amountMinor: 99_999 }] }) })));
    expect(short.status).toBe(422);
    expect(short.body.error).toMatch(/Not enough stock/);
    const levels = await json(await stockLevels(req(full, "/stock")));
    expect(levels.body.data[0]).toMatchObject({ productId, onHand: 80, sellable: 80 });
    const batches = await json(await stockBatches(req(full, "/stock/batches?expiringWithinDays=365")));
    expect(batches.body.data[0]).toMatchObject({ batchNo: "B1", qtyOnHand: 80 });
  });

  it("creates customers only within the key's tenant, audited with the key", async () => {
    const created = await json(await createCustomer(req(full, "/customers", { method: "POST", body: JSON.stringify({ name: "Ama Owusu", phone: "024 123 4567" }) })));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ phone: "+233241234567", messagingConsent: false });
    const list = await json(await listCustomers(req(full, "/customers")));
    expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(["Ama Owusu"]);
    expect((await getCustomer(req(full, `/customers/${otherCustomer}`), ctx(otherCustomer))).status).toBe(404);
    const sale = await json(await createSale(req(full, "/sales", { method: "POST", body: JSON.stringify({ clientId: "api-sale-000003", customerId: otherCustomer, lines: [{ productId, unitId, qty: 1 }], payments: [{ method: "cash", amountMinor: 500 }] }) })));
    expect(sale.status).toBe(422);
    const [log] = await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, created.body.id));
    expect(log.details).toMatchObject({ via: "api" });
    expect((await createCustomer(req(readOnly, "/customers", { method: "POST", body: "{}" }))).status).toBe(403);
  });

  it("serves the recall feed and the OpenAPI document", async () => {
    expect((await json(await listRecalls(req(full, "/recalls")))).status).toBe(200);
    const spec = await (await specRoute()).json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toContain("/sales/{id}");
  });
});
