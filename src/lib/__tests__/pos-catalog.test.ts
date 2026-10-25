import { describe, expect, it } from "vitest";
import { applyLocalSale, fefoPreview, lookupBarcode, searchCatalog, stockOf, type PosCatalog } from "@/lib/pos-catalog";

const unit = (id: string, factor: number, isDefault = false) => ({ id, name: id, factor, priceMinor: factor * 10, isDefault });
const c = {
  today: "2026-10-25",
  products: [
    { id: "p1", name: "Panadol Extra", generic: "Paracetamol", strength: "500 mg", form: "tablet", schedule: "otc", baseUnit: "tablet", taxBp: 0, favorite: true, shelf: null, units: [unit("tab", 1), unit("strip", 10, true)] },
    { id: "p2", name: "Amoxil", generic: "Amoxicillin", strength: "500 mg", form: "capsule", schedule: "pom", baseUnit: "capsule", taxBp: 0, favorite: false, shelf: null, units: [unit("cap", 1, true)] },
    { id: "p3", name: "Paracetamol syrup", generic: "Paracetamol", strength: "120 mg/5 ml", form: "syrup", schedule: "otc", baseUnit: "bottle", taxBp: 0, favorite: false, shelf: null, units: [unit("btl", 1, true)] },
  ],
  barcodes: [["6001234567890", "p1", "strip"]] as PosCatalog["barcodes"],
  batches: [
    { id: "b-late", productId: "p1", batchNo: "L", expiry: "2028-01-01", qty: 30 },
    { id: "b-old", productId: "p1", batchNo: "X", expiry: "2026-01-01", qty: 50 }, // expired
    { id: "b-soon", productId: "p1", batchNo: "S", expiry: "2027-01-01", qty: 15 },
    { id: "b-amx", productId: "p2", batchNo: "A", expiry: "2027-05-01", qty: 4 },
  ],
};

describe("till catalogue helpers", () => {
  it("scans barcodes to the pack they label", () => {
    expect(lookupBarcode(c, " 6001234567890 ")?.unit.id).toBe("strip");
    expect(lookupBarcode(c, "nope")).toBeNull();
  });
  it("searches brand and generic, all words, in-stock first", () => {
    expect(searchCatalog(c, "paracetamol").map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(searchCatalog(c, "amox 500").map((p) => p.id)).toEqual(["p2"]);
    expect(searchCatalog(c, "6001234567890").map((p) => p.id)).toEqual(["p1"]);
  });
  it("previews FEFO skipping expired batches and reports shortfall", () => {
    expect(stockOf(c, "p1")).toBe(45);
    const f = fefoPreview(c, "p1", 20);
    expect(f.batches.map((b) => [b.batchNo, b.qty])).toEqual([["S", 15], ["L", 5]]);
    expect(fefoPreview(c, "p2", 6).short).toBe(2);
  });
  it("decrements local stock across lines without going negative", () => {
    const next = applyLocalSale(c, [{ productId: "p1", baseQty: 10 }, { productId: "p1", baseQty: 10 }, { productId: "p2", baseQty: 9 }]);
    expect(next.find((b) => b.id === "b-soon")!.qty).toBe(0);
    expect(next.find((b) => b.id === "b-late")!.qty).toBe(25);
    expect(next.find((b) => b.id === "b-amx")!.qty).toBe(0);
    expect(c.batches.find((b) => b.id === "b-soon")!.qty).toBe(15); // input untouched
  });
});
