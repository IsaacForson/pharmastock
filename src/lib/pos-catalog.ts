/**
 * The till's offline catalogue: shape of the /api/pos/catalog snapshot plus pure helpers the till uses to search, scan,
 * preview FEFO and decrement stock locally. No server imports: this runs in the browser.
 */
import { allocateFefo } from "./pos-math";

export const CATALOG_VERSION = 1;

export type CatUnit = { id: string; name: string; factor: number; priceMinor: number; isDefault: boolean };
export type CatProduct = {
  id: string; name: string; generic: string | null; strength: string | null; form: string | null; schedule: string;
  baseUnit: string; taxBp: number | null; favorite: boolean; shelf: string | null; units: CatUnit[];
};
export type CatBatch = { id: string; productId: string; batchNo: string; expiry: string | null; qty: number };
export type CatCustomer = {
  id: string; name: string; customerNo: string; phone: string | null; balanceMinor: number; creditLimitMinor: number; points: number;
  payerId: string | null; memberNo: string | null; consent: boolean;
};

export type PosCatalog = {
  v: number;
  builtAt: string; // ISO
  today: string; // YYYY-MM-DD in the pharmacy's timezone
  branchId: string;
  tenant: {
    name: string; branch: string | null; address: string | null; phone: string | null; licenceNo: string | null; taxId: string | null;
    letterhead: string | null; footer: string | null; country: string; currency: string; timezone: string; inclusive: boolean; defaultTaxBp: number;
    taxName: string; labelWarning: string; mobileMoney: string[]; loyaltyEnabled: boolean; pointValueMinor: number; earnPerMajor: number;
    scheduleLabels: Record<string, string>; controlledAllowed: boolean;
  };
  user: { id: string; name: string; canOverride: boolean; canDiscount: boolean; canCredit: boolean; sellsPharmacy: boolean; maxDiscountBp: number };
  products: CatProduct[];
  barcodes: [code: string, productId: string, unitId: string][];
  batches: CatBatch[];
  customers: CatCustomer[];
  pharmacists: { id: string; name: string }[];
  payers: { id: string; name: string; coverageBp: number }[];
};

export const defaultUnit = (p: CatProduct) => p.units.find((u) => u.isDefault) ?? [...p.units].sort((a, b) => a.factor - b.factor)[0];

/** Sellable base units of a product on this device's copy of the books. */
export function stockOf(c: Pick<PosCatalog, "batches" | "today">, productId: string) {
  return c.batches.filter((b) => b.productId === productId && b.qty > 0 && (!b.expiry || b.expiry >= c.today)).reduce((s, b) => s + b.qty, 0);
}

export function lookupBarcode(c: Pick<PosCatalog, "barcodes" | "products">, code: string): { product: CatProduct; unit: CatUnit } | null {
  const hit = c.barcodes.find(([k]) => k === code.trim());
  if (!hit) return null;
  const product = c.products.find((p) => p.id === hit[1]);
  const unit = product?.units.find((u) => u.id === hit[2]);
  return product && unit ? { product, unit } : null;
}

/** Brand, generic and strength search; every word must match. Exact barcodes win; in-stock items rank first. */
export function searchCatalog(c: Pick<PosCatalog, "barcodes" | "products" | "batches" | "today">, q: string, limit = 12): CatProduct[] {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const code = lookupBarcode(c, term);
  if (code) return [code.product];
  const words = term.split(/\s+/);
  const scored: { p: CatProduct; score: number }[] = [];
  for (const p of c.products) {
    const hay = `${p.name} ${p.generic ?? ""} ${p.strength ?? ""} ${p.form ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const name = p.name.toLowerCase();
    const score = (name.startsWith(term) ? 0 : name.includes(term) ? 1 : 2) + (stockOf(c, p.id) > 0 ? 0 : 10);
    scored.push({ p, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name)).slice(0, limit).map((x) => x.p);
}

/** Which batches FEFO will take for a line, with each batch's number and expiry. */
export function fefoPreview(c: Pick<PosCatalog, "batches" | "today">, productId: string, baseQty: number) {
  const batches = c.batches.filter((b) => b.productId === productId);
  const { allocations, short } = allocateFefo(batches.map((b) => ({ id: b.id, qtyOnHand: b.qty, expiry: b.expiry })), baseQty, c.today);
  return {
    short,
    batches: allocations.map((a) => {
      const b = batches.find((x) => x.id === a.batchId)!;
      return { batchId: b.id, batchNo: b.batchNo, expiry: b.expiry, qty: a.qty };
    }),
  };
}

/**
 * Takes a sale's quantities out of the local batches (FEFO, never below zero) so the next sale offline sees the right
 * stock. Several lines of the same product are taken in order. Returns the new batches array.
 */
export function applyLocalSale(c: Pick<PosCatalog, "batches" | "today">, lines: { productId: string; baseQty: number }[]): CatBatch[] {
  const batches = c.batches.map((b) => ({ ...b }));
  for (const l of lines) {
    const { batches: taken } = fefoPreview({ batches, today: c.today }, l.productId, l.baseQty);
    for (const t of taken) batches.find((b) => b.id === t.batchId)!.qty -= t.qty;
  }
  return batches;
}

/** Small client id for idempotent sales from this device. */
export const newClientId = () => `till-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
