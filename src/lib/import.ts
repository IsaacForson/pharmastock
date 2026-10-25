import { and, eq, ilike, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { barcodes, categories, productUnits, products, supplierPrices } from "@/db/schema";
import type { Ctx } from "./auth";
import { audit } from "./auth";
import { setUnitPrice } from "./catalog";
import { emit } from "./events";
import { receiveIntoBatch } from "./stock";

/**
 * Product / price-list / opening-stock import: file parsing (CSV or Excel), column auto-detection, fuzzy matching to the
 * existing catalogue, and the commit that creates products, supplier prices and opening batches.
 */

// ---------- Parsing ----------
export type Grid = string[][];

/** RFC-4180-ish CSV with quoted fields; delimiter auto-detected from the first line (, ; or tab). */
export function parseCsv(text: string): Grid {
  const src = text.replace(/^﻿/, "");
  const first = src.slice(0, src.indexOf("\n") >>> 0);
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Grid = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return clean(rows);
}

const clean = (g: Grid) => g.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** CSV text or an .xlsx workbook (first sheet) as a grid of trimmed strings. Dates become YYYY-MM-DD. */
export async function parseSheet(buf: Buffer, filename: string): Promise<Grid> {
  if (/\.xlsx$/i.test(filename) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const { default: readXlsxFile } = await import("read-excel-file/node");
    const rows = await readXlsxFile(buf);
    return clean(rows.map((r) => r.map((c) => c == null ? "" : c instanceof Date ? iso(c) : String(c))));
  }
  if (/\.xls$/i.test(filename)) throw new Error("Old .xls files aren't supported. Save as .xlsx or CSV and try again.");
  return parseCsv(buf.toString("utf8"));
}

// ---------- Columns ----------
export const FIELDS = {
  name: "Product name", genericName: "Generic name", strength: "Strength", form: "Form", manufacturer: "Manufacturer",
  category: "Category", barcode: "Barcode", supplierCode: "Supplier code", packName: "Pack name", packSize: "Pack size",
  cost: "Cost price (per pack)", price: "Selling price (per pack)", batchNo: "Batch no.", expiry: "Expiry", qty: "Quantity (packs)",
} as const;
export type ImportField = keyof typeof FIELDS;
export type Mapping = Partial<Record<ImportField, number>>;

const SYNONYMS: Record<ImportField, string[]> = {
  name: ["product", "product name", "item", "item name", "description", "name", "brand", "trade name", "drug", "medicine"],
  genericName: ["generic", "generic name", "inn", "active ingredient", "molecule"],
  strength: ["strength", "dose", "dosage", "str"],
  form: ["form", "dosage form", "formulation", "type"],
  manufacturer: ["manufacturer", "mfr", "maker", "brand owner", "company"],
  category: ["category", "class", "group", "therapeutic class"],
  barcode: ["barcode", "ean", "gtin", "upc", "bar code"],
  supplierCode: ["code", "item code", "supplier code", "sku", "product code", "ref"],
  packName: ["unit", "pack", "uom", "pack name", "unit of measure"],
  packSize: ["pack size", "packsize", "size", "qty per pack", "units per pack", "pcs per pack"],
  cost: ["cost", "cost price", "unit cost", "price", "trade price", "wholesale price", "supplier price", "buying price"],
  price: ["selling price", "sell price", "retail price", "retail", "rrp", "mrp", "sale price"],
  batchNo: ["batch", "batch no", "batch number", "lot", "lot no"],
  expiry: ["expiry", "expiry date", "exp", "exp date", "expires", "best before"],
  qty: ["qty", "quantity", "stock", "on hand", "balance", "count", "qty on hand"],
};

/** Best-guess column for each field from the header row (exact synonym first, then containment). */
export function detectMapping(header: string[]): Mapping {
  const h = header.map((x) => x.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
  const used = new Set<number>(), m: Mapping = {};
  // Money columns claim "… price" headers before "unit" / "pack" catch-alls do.
  const order: ImportField[] = ["name", "genericName", "strength", "barcode", "price", "cost", "batchNo", "expiry", "qty", "packSize", "packName", "supplierCode", "manufacturer", "category", "form"];
  for (const pass of ["exact", "contains"] as const) {
    for (const f of order) {
      if (m[f] !== undefined) continue;
      for (const s of SYNONYMS[f]) {
        const i = h.findIndex((x, j) => !used.has(j) && (pass === "exact" ? x === s : x.includes(s)));
        if (i >= 0) { m[f] = i; used.add(i); break; }
      }
    }
  }
  return m;
}

// ---------- Values ----------
/** "GH₵ 1,250.50" → 125050. Null when blank or not a number. */
export function parseMoneyMinor(s: string | undefined): number | null {
  if (!s) return null;
  const v = Number(s.replace(/[^\d.-]/g, ""));
  return s.trim() && Number.isFinite(v) && /\d/.test(s) ? Math.round(v * 100) : null;
}
export function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  const v = Number(s.replace(/[^\d.-]/g, ""));
  return /\d/.test(s) && Number.isFinite(v) ? v : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const lastDay = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** Expiry in many shapes: 2027-03-31, 31/03/2027, 03/2027, Mar-27, MAR 2027, Excel serial. Month-only → last day. */
export function parseExpiry(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return valid(year(m[3]), +m[2], +m[1]);
  if ((m = t.match(/^(\d{1,2})[/.-](\d{4}|\d{2})$/))) return +m[1] >= 1 && +m[1] <= 12 ? lastDay(year(m[2]), +m[1]) : null;
  if ((m = t.match(/^(\d{4})[/.-](\d{1,2})$/))) return lastDay(+m[1], +m[2]);
  if ((m = t.match(/^([a-z]{3})[a-z]*[\s/.-]*(\d{4}|\d{2})$/)) && MONTHS.includes(m[1])) return lastDay(year(m[2]), MONTHS.indexOf(m[1]) + 1);
  if (/^\d{5}(\.\d+)?$/.test(t)) return iso(new Date(Date.UTC(1899, 11, 30) + Math.floor(+t) * 86400_000));
  return null;
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? iso(dt) : null;
}

export type ImportRecord = {
  line: number; name: string; genericName: string | null; strength: string | null; form: string | null; manufacturer: string | null;
  category: string | null; barcode: string | null; supplierCode: string | null; packName: string | null; packSize: number | null;
  costMinor: number | null; priceMinor: number | null; batchNo: string | null; expiry: string | null; qty: number | null; errors: string[];
};

/** Grid rows (header excluded) → typed records using the mapping. `line` is the spreadsheet row number. */
export function toRecords(rows: Grid, map: Mapping, firstLine = 2): ImportRecord[] {
  const get = (r: string[], f: ImportField) => (map[f] === undefined ? undefined : (r[map[f]!] ?? "").trim() || undefined);
  return rows.map((r, i) => {
    const errors: string[] = [];
    const packSize = parseNum(get(r, "packSize"));
    const qty = parseNum(get(r, "qty"));
    const expRaw = get(r, "expiry");
    const expiry = parseExpiry(expRaw);
    if (expRaw && !expiry) errors.push(`Couldn't read expiry "${expRaw}"`);
    if (packSize !== null && (packSize < 1 || !Number.isInteger(packSize))) errors.push("Pack size must be a whole number of 1 or more");
    if (qty !== null && qty < 0) errors.push("Quantity can't be negative");
    const name = get(r, "name") ?? "";
    if (!name) errors.push("No product name");
    return {
      line: firstLine + i, name, genericName: get(r, "genericName") ?? null, strength: get(r, "strength") ?? null, form: get(r, "form") ?? null,
      manufacturer: get(r, "manufacturer") ?? null, category: get(r, "category") ?? null, barcode: get(r, "barcode")?.replace(/\s+/g, "") ?? null,
      supplierCode: get(r, "supplierCode") ?? null, packName: get(r, "packName") ?? null, packSize: packSize && packSize >= 1 ? Math.round(packSize) : null,
      costMinor: parseMoneyMinor(get(r, "cost")), priceMinor: parseMoneyMinor(get(r, "price")),
      batchNo: get(r, "batchNo") ?? null, expiry, qty: qty !== null && qty >= 0 ? qty : null, errors,
    };
  });
}

// ---------- Fuzzy matching ----------
const FORM_WORDS: Record<string, string> = {
  tab: "tablet", tabs: "tablet", tablets: "tablet", tbl: "tablet", cap: "capsule", caps: "capsule", capsules: "capsule",
  syr: "syrup", susp: "suspension", inj: "injection", amp: "ampoule", amps: "ampoule", crm: "cream", oint: "ointment",
  supp: "suppository", supps: "suppository", soln: "solution", sol: "solution", drops: "drop", gtt: "drop", sachets: "sachet",
};

/** Lower-case, unify units ("500 mg" → "500mg") and form abbreviations, drop punctuation. */
export function normalise(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/&/g, " and ")
    .replace(/(\d+(?:\.\d+)?)\s*(mcg|µg|mg|ml|g|iu|%|l)\b/g, (_, n, u) => `${n}${u === "µg" ? "mcg" : u}`)
    .replace(/[^a-z0-9.%/ ]+/g, " ").split(/\s+/).map((w) => w.replace(/^[./]+|[./]+$/g, "")).filter(Boolean).map((w) => FORM_WORDS[w] ?? w).join(" ");
}
const strengths = (s: string) => new Set(s.match(/\d+(?:\.\d+)?(?:mcg|mg|ml|g|iu|%|l)/g) ?? []);
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.split(" ")) { const p = `  ${w} `; for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3)); }
  return out;
}
const dice = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return a.size + b.size ? (2 * n) / (a.size + b.size) : 0; };

/** Similarity 0..1 of two normalised strings: trigram Dice + token overlap, halved when both state different strengths. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(a.split(" ")), tb = new Set(b.split(" "));
  let common = 0; for (const x of ta) if (tb.has(x)) common++;
  let s = 0.6 * dice(trigrams(a), trigrams(b)) + 0.4 * (common / new Set([...ta, ...tb]).size);
  const sa = strengths(a), sb = strengths(b);
  if (sa.size && sb.size && ![...sa].some((x) => sb.has(x))) s *= 0.5;
  return Math.round(s * 1000) / 1000;
}

export type CatalogItem = { id: string; name: string; genericName: string | null; strength: string | null; form: string | null; barcodes: string[] };
export type Match = { status: "match" | "review" | "new"; productId: string | null; score: number; via: "barcode" | "name" | null; candidates: { id: string; score: number }[] };
export const MATCH_AT = 0.82, REVIEW_AT = 0.55;

const keyOf = (name: string | null, strength: string | null, form: string | null) => normalise([name, strength, form].filter(Boolean).join(" "));

/** Pre-computed index over the catalogue: barcode map + trigram inverted index for fast candidate lookup. */
export function buildIndex(items: CatalogItem[]) {
  const byCode = new Map<string, string>();
  const keys = items.map((p) => {
    for (const c of p.barcodes) byCode.set(c, p.id);
    return { id: p.id, keys: [keyOf(p.name, p.strength, p.form), p.genericName ? keyOf(p.genericName, p.strength, p.form) : ""].filter(Boolean) };
  });
  const inv = new Map<string, number[]>();
  keys.forEach((k, i) => { for (const g of new Set(k.keys.flatMap((x) => [...trigrams(x)]))) { const l = inv.get(g); if (l) l.push(i); else inv.set(g, [i]); } });
  return { byCode, keys, inv };
}
export type CatalogIndex = ReturnType<typeof buildIndex>;

export function matchRecord(idx: CatalogIndex, r: Pick<ImportRecord, "name" | "genericName" | "strength" | "form" | "barcode">): Match {
  if (r.barcode && idx.byCode.has(r.barcode)) return { status: "match", productId: idx.byCode.get(r.barcode)!, score: 1, via: "barcode", candidates: [] };
  const queries = [keyOf(r.name, r.strength, r.form), r.genericName ? keyOf(r.genericName, r.strength, r.form) : ""].filter(Boolean);
  if (!queries.length) return { status: "new", productId: null, score: 0, via: null, candidates: [] };
  // Rare trigrams pick candidates; ones shared by most of the catalogue ("tab", "mg ") only when nothing rarer exists.
  const grams = [...new Set(queries.flatMap((q) => [...trigrams(q)]))].map((g) => idx.inv.get(g) ?? []).filter((l) => l.length).sort((a, b) => a.length - b.length);
  const cap = Math.max(50, idx.keys.length / 20);
  const use = grams.filter((l) => l.length <= cap);
  const hits = new Map<number, number>();
  for (const l of use.length ? use : grams.slice(0, 3)) for (const i of l) hits.set(i, (hits.get(i) ?? 0) + 1);
  const pool = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  const scored = pool.map(([i]) => ({ id: idx.keys[i].id, score: Math.max(...idx.keys[i].keys.flatMap((k) => queries.map((q) => similarity(q, k)))) }))
    .sort((a, b) => b.score - a.score).slice(0, 3);
  const best = scored[0];
  if (!best || best.score < REVIEW_AT) return { status: "new", productId: null, score: best?.score ?? 0, via: null, candidates: scored };
  return { status: best.score >= MATCH_AT ? "match" : "review", productId: best.id, score: best.score, via: "name", candidates: scored };
}

/** The tenant's catalogue in matcher form. */
export async function loadCatalog(t: Tx): Promise<CatalogItem[]> {
  const rows = await t.select({ id: products.id, name: products.name, genericName: products.genericName, strength: products.strength, form: products.form,
    codes: sql<string[]>`coalesce(array_agg(${barcodes.code}) filter (where ${barcodes.code} is not null), '{}')` })
    .from(products).leftJoin(barcodes, eq(barcodes.productId, products.id)).groupBy(products.id);
  return rows.map((r) => ({ ...r, barcodes: r.codes ?? [] }));
}

// ---------- Commit ----------
export type CommitRow = ImportRecord & { productId: string | null };
export type CommitOptions = { supplierId: string | null; openingStock: boolean; updatePrices: boolean; branchId: string };
export type CommitResult = { created: number; updated: number; supplierPrices: number; batches: number; priceChanges: number; warnings: string[] };

const singular = (s: string) => normalise(s).split(" ")[0] || "unit";

/**
 * Applies confirmed import rows. productId null = create a new product (reusing one with the same name, strength and form
 * if an earlier row already created it). Opening stock goes in through the stock ledger as type receive, ref IMPORT.
 */
export async function commitImport(t: Tx, ctx: Ctx, rows: CommitRow[], o: CommitOptions): Promise<CommitResult> {
  const res: CommitResult = { created: 0, updated: 0, supplierPrices: 0, batches: 0, priceChanges: 0, warnings: [] };
  const catCache = new Map<string, string>();
  const categoryId = async (name: string | null) => {
    if (!name) return null;
    const k = name.toLowerCase();
    if (!catCache.has(k)) {
      const [c] = await t.select({ id: categories.id }).from(categories).where(ilike(categories.name, name)).limit(1);
      catCache.set(k, c?.id ?? (await t.insert(categories).values({ tenantId: ctx.tenant.id, name }).returning({ id: categories.id }))[0].id);
    }
    return catCache.get(k)!;
  };

  for (const r of rows) {
    if (r.errors.length) { res.warnings.push(`Row ${r.line}: skipped (${r.errors.join("; ")})`); continue; }
    let productId = r.productId;
    if (productId) {
      const [ok] = await t.select({ id: products.id }).from(products).where(eq(products.id, productId));
      if (!ok) { res.warnings.push(`Row ${r.line}: matched product no longer exists, skipped`); continue; }
      res.updated++;
    } else {
      const [same] = await t.select({ id: products.id }).from(products).where(and(
        sql`lower(${products.name}) = ${r.name.toLowerCase()}`,
        sql`coalesce(lower(${products.strength}), '') = ${(r.strength ?? "").toLowerCase()}`,
        sql`coalesce(lower(${products.form}), '') = ${(r.form ?? "").toLowerCase()}`)).limit(1);
      if (same) { productId = same.id; res.updated++; }
      else {
        const base = r.form ? singular(r.form) : "unit";
        const [p] = await t.insert(products).values({
          tenantId: ctx.tenant.id, name: r.name, genericName: r.genericName, strength: r.strength, form: r.form, manufacturer: r.manufacturer,
          categoryId: await categoryId(r.category), baseUnit: base, preferredSupplierId: o.supplierId,
        }).returning();
        const size = r.packSize ?? 1;
        await t.insert(productUnits).values(size > 1
          ? [{ tenantId: ctx.tenant.id, productId: p.id, name: base, factor: 1, sellPriceMinor: r.priceMinor ? Math.round(r.priceMinor / size) : 0, sellable: true },
             { tenantId: ctx.tenant.id, productId: p.id, name: r.packName ?? "pack", factor: size, sellPriceMinor: r.priceMinor ?? 0, isDefault: true }]
          : [{ tenantId: ctx.tenant.id, productId: p.id, name: r.packName ?? base, factor: 1, sellPriceMinor: r.priceMinor ?? 0, isDefault: true }]);
        await audit(t, ctx, "create", "product", p.id, { details: { via: "import", line: r.line } });
        await emit(t, ctx.tenant.id, "product.created", { id: p.id, name: p.name });
        productId = p.id;
        res.created++;
      }
    }

    // The unit this row is about: same pack size, else the default unit; a new pack size becomes a new unit.
    const units = await t.select().from(productUnits).where(eq(productUnits.productId, productId));
    let unit = r.packSize ? units.find((u) => u.factor === r.packSize) : units.find((u) => u.isDefault) ?? units[0];
    if (!unit) {
      [unit] = await t.insert(productUnits).values({ tenantId: ctx.tenant.id, productId, name: r.packName ?? `pack of ${r.packSize ?? 1}`, factor: r.packSize ?? 1, sellPriceMinor: r.priceMinor ?? 0, isDefault: !units.length }).returning();
    } else if (o.updatePrices && r.priceMinor !== null && r.priceMinor !== unit.sellPriceMinor) {
      await setUnitPrice(t, ctx, unit, r.priceMinor);
      res.priceChanges++;
    }

    if (r.barcode) {
      const [owner] = await t.select({ productId: barcodes.productId }).from(barcodes).where(eq(barcodes.code, r.barcode));
      if (!owner) await t.insert(barcodes).values({ tenantId: ctx.tenant.id, code: r.barcode, productId, unitId: unit.id });
      else if (owner.productId !== productId) res.warnings.push(`Row ${r.line}: barcode ${r.barcode} already belongs to another product`);
    }

    if (o.supplierId && r.costMinor !== null) {
      await t.insert(supplierPrices).values({ tenantId: ctx.tenant.id, supplierId: o.supplierId, productId, unitId: unit.id, costMinor: r.costMinor, supplierCode: r.supplierCode, source: "import" })
        .onConflictDoUpdate({ target: [supplierPrices.supplierId, supplierPrices.productId, supplierPrices.unitId], set: { costMinor: r.costMinor, supplierCode: r.supplierCode, source: "import", updatedAt: new Date() } });
      res.supplierPrices++;
    }

    if (o.openingStock && r.qty) {
      const baseQty = Math.round(r.qty * unit.factor);
      if (baseQty > 0) {
        await receiveIntoBatch(t, ctx, {
          productId, branchId: o.branchId, qty: baseQty, batchNo: r.batchNo, expiry: r.expiry,
          unitCostMinor: r.costMinor !== null ? r.costMinor / unit.factor : 0, supplierId: o.supplierId, type: "receive", ref: "IMPORT", reason: "Opening stock import",
        });
        res.batches++;
      }
    }
  }
  await audit(t, ctx, "import", "product", null, { details: { ...res, warnings: res.warnings.length, rows: rows.length, supplierId: o.supplierId } });
  if (res.batches) await emit(t, ctx.tenant.id, "stock.received", { ref: "IMPORT", branchId: o.branchId, batches: res.batches });
  return res;
}
