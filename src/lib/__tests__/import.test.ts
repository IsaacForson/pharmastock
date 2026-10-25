import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import { barcodes, branches, priceChanges, productUnits, products, stockBatches, supplierPrices, suppliers } from "@/db/schema";
import type { Ctx } from "@/lib/auth";
import { findByBarcode, packs, searchProducts } from "@/lib/catalog";
import {
  buildIndex, commitImport, detectMapping, loadCatalog, matchRecord, normalise, parseCsv, parseExpiry, parseMoneyMinor, similarity, toRecords,
} from "@/lib/import";
import { purgeTenant, provisionTenant } from "@/lib/provision";

describe("parsing", () => {
  it("parses quoted CSV with auto delimiter", () => {
    expect(parseCsv('Name,Price\n"Para, 500mg",1.50\r\n"He said ""hi""",2\n\n')).toEqual([["Name", "Price"], ["Para, 500mg", "1.50"], ['He said "hi"', "2"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("detects columns", () => {
    const m = detectMapping(["Item Description", "Generic", "Strength", "Pack Size", "Unit Price", "Retail Price", "Batch No", "Exp. Date", "Qty", "Barcode"]);
    expect(m).toMatchObject({ name: 0, genericName: 1, strength: 2, packSize: 3, cost: 4, price: 5, batchNo: 6, expiry: 7, qty: 8, barcode: 9 });
  });
  it("reads money and expiry formats", () => {
    expect(parseMoneyMinor("GH₵ 1,250.50")).toBe(125050);
    expect(parseMoneyMinor("")).toBeNull();
    expect(parseExpiry("2027-03-31")).toBe("2027-03-31");
    expect(parseExpiry("31/03/2027")).toBe("2027-03-31");
    expect(parseExpiry("02/2028")).toBe("2028-02-29");
    expect(parseExpiry("Mar-27")).toBe("2027-03-31");
    expect(parseExpiry("MARCH 2027")).toBe("2027-03-31");
    expect(parseExpiry("46112")).toBe("2026-03-31");
    expect(parseExpiry("31/02/2027")).toBeNull();
  });
  it("flags bad rows", () => {
    const [r] = toRecords([["", "x", "-1"]], { name: 0, expiry: 1, qty: 2 });
    expect(r.errors.length).toBe(3);
    expect(r.qty).toBeNull();
  });
});

describe("matching", () => {
  const idx = buildIndex([
    { id: "p1", name: "Panadol", genericName: "Paracetamol", strength: "500 mg", form: "Tablet", barcodes: ["5000000000001"] },
    { id: "p2", name: "Amoxil", genericName: "Amoxicillin", strength: "250 mg", form: "Capsule", barcodes: [] },
    { id: "p3", name: "Amoxil", genericName: "Amoxicillin", strength: "500 mg", form: "Capsule", barcodes: [] },
    { id: "p4", name: "Coartem", genericName: "Artemether/Lumefantrine", strength: "20/120 mg", form: "Tablet", barcodes: [] },
  ]);
  it("normalises units and forms", () => expect(normalise("Amoxil 500 MG Caps.")).toBe("amoxil 500mg capsule"));
  it("matches exact barcode first", () => expect(matchRecord(idx, { name: "zzz", genericName: null, strength: null, form: null, barcode: "5000000000001" })).toMatchObject({ productId: "p1", via: "barcode", status: "match" }));
  it("matches messy names and respects strength", () => {
    expect(matchRecord(idx, { name: "AMOXIL CAPS 500MG", genericName: null, strength: null, form: null, barcode: null })).toMatchObject({ productId: "p3", status: "match" });
    expect(matchRecord(idx, { name: "Paracetamol", genericName: null, strength: "500mg", form: "tabs", barcode: null }).productId).toBe("p1");
    expect(similarity(normalise("amoxil 250mg"), normalise("amoxil 500mg"))).toBeLessThan(0.55);
  });
  it("proposes new for unknown products", () => expect(matchRecord(idx, { name: "Vitamin C Effervescent", genericName: null, strength: "1 g", form: null, barcode: null }).status).toBe("new"));
  it("is fast enough for thousands of rows", () => {
    const big = buildIndex(Array.from({ length: 3000 }, (_, i) => ({ id: `x${i}`, name: `Product ${i} Brand`, genericName: `Generic ${i % 50}`, strength: `${i % 9}00 mg`, form: "Tablet", barcodes: [] })));
    const t0 = performance.now();
    for (let i = 0; i < 3000; i++) matchRecord(big, { name: `Product ${i} Brand`, genericName: null, strength: `${i % 9}00mg`, form: "tab", barcode: null });
    expect(performance.now() - t0).toBeLessThan(10_000);
  }, 30_000);
});

describe("commit + catalogue search (db)", () => {
  let ctx: Ctx;
  let supplierId: string;
  beforeAll(async () => {
    const { tenant, owner } = await provisionTenant({ pharmacyName: "Import Test", country: "GH", ownerName: "Ama", email: `imp-${Date.now()}@test.local`, password: "correct horse battery" });
    const [branch] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
    ctx = { user: owner, tenant, sessionId: "test", branchId: branch.id, branches: [{ id: branch.id, name: branch.name }], access: "full", ip: null, impersonatedBy: null };
    supplierId = await withTenant(tenant.id, async (t) => (await t.insert(suppliers).values({ tenantId: tenant.id, name: "Ernest Chemists" }).returning())[0].id);
  });
  afterAll(async () => { await purgeTenant(ctx.tenant.id); });

  it("creates products, supplier prices and opening stock, then matches them on a second import", async () => {
    const grid = parseCsv("Product,Strength,Form,Pack,Pack size,Cost,Retail,Batch,Expiry,Qty,Barcode\nPanadol,500 mg,Tablet,box,100,50.00,80.00,b1,12/2030,2,6001234567890\nPanadol,500 mg,Tablet,box,100,50.00,80.00,b2,01/2031,1,\nOld Stock,,,,,1,2,,31/01/2020,3,");
    const map = detectMapping(grid[0]);
    const recs = toRecords(grid.slice(1), map);
    const r1 = await withTenant(ctx.tenant.id, (t) => commitImport(t, ctx, recs.map((r) => ({ ...r, productId: null })), { supplierId, openingStock: true, updatePrices: false, branchId: ctx.branchId }));
    expect(r1).toMatchObject({ created: 2, updated: 1, batches: 3, supplierPrices: 3 });
    await withTenant(ctx.tenant.id, async (t) => {
      const [p] = await t.select().from(products).where(eq(products.name, "Panadol"));
      const units = await t.select().from(productUnits).where(eq(productUnits.productId, p.id));
      expect(units.map((u) => [u.name, u.factor, u.sellPriceMinor, u.isDefault]).sort()).toEqual([["box", 100, 8000, true], ["tablet", 1, 80, false]]);
      const b = await t.select().from(stockBatches).where(eq(stockBatches.productId, p.id));
      expect(b.map((x) => [x.batchNo, x.qtyOnHand, x.expiry, x.unitCostMinor]).sort()).toEqual([["B1", 200, "2030-12-31", 50], ["B2", 100, "2031-01-31", 50]]);
      expect((await t.select().from(supplierPrices).where(eq(supplierPrices.productId, p.id)))[0].costMinor).toBe(5000);
      const hit = await findByBarcode(t, "6001234567890");
      expect(hit?.product.id).toBe(p.id);
      expect(hit?.unit.factor).toBe(100);
      const found = await searchProducts(t, "pana", ctx.branchId);
      expect(found[0]).toMatchObject({ onHand: 300, nextExpiry: "2030-12-31" });
      expect(found[0].units[0].isDefault).toBe(true);
      // Search by barcode goes through a correlated subquery on products (regression: it once bound to barcodes.id).
      expect((await searchProducts(t, "6001234567890", ctx.branchId)).map((x) => x.product.id)).toEqual([p.id]);
      const old = await searchProducts(t, "old stock", ctx.branchId);
      expect(old[0].onHand).toBe(0); // expired batch is not sellable
      expect(packs(300, units, "tablet")).toBe("3 box");
      expect(packs(250, units, "tablet")).toBe("2 box + 50 tablet");
    });

    const catalog = await withTenant(ctx.tenant.id, (t) => loadCatalog(t));
    const idx = buildIndex(catalog);
    const second = toRecords([["PANADOL TABS 500MG", "100", "45.00", "90.00"]], { name: 0, packSize: 1, cost: 2, price: 3 });
    const m = matchRecord(idx, second[0]);
    expect(m.status).toBe("match");
    const r2 = await withTenant(ctx.tenant.id, (t) => commitImport(t, ctx, [{ ...second[0], productId: m.productId }], { supplierId, openingStock: false, updatePrices: true, branchId: ctx.branchId }));
    expect(r2).toMatchObject({ created: 0, updated: 1, priceChanges: 1, supplierPrices: 1 });
    await withTenant(ctx.tenant.id, async (t) => {
      expect((await t.select().from(priceChanges)).map((c) => [c.oldPriceMinor, c.newPriceMinor])).toEqual([[8000, 9000]]);
      expect((await t.select().from(barcodes)).length).toBe(1);
    });
  });
});
