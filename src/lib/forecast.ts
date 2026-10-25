import { and, eq, gte, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { categories, products, saleLines, sales } from "@/db/schema";
import { addDays, dayRange, localDay } from "./format";

/**
 * Demand forecasting. A product's seasonal factor multiplies its recent daily demand in the reorder maths
 * (@/lib/reorder). With enough sales history it comes from the product's own past (same calendar month last year vs the
 * trailing 12-month average); without it, from market seasonality hints for the product's category in the pharmacy's
 * country. Pure helpers are exported for tests; `seasonalFactors` / `forecastDetails` load from the database.
 */

export const MIN_HISTORY_MONTHS = 13; // last year's same month + a trailing year
export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 2;
const SMOOTHING = 0.6; // weight on the observed seasonal index; the rest pulls toward 1

/** "2026-10" -> "2025-10" etc. */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

const clamp = (v: number) => Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, v));

/**
 * Pure: seasonal factor for `month` from monthly unit sales (YYYY-MM -> base units). Same month last year (smoothed with
 * its neighbours 1:2:1) divided by the average of the 12 full months before `month`, shrunk toward 1 and clamped.
 * Returns null when there is not enough history (first sale less than MIN_HISTORY_MONTHS before `month`, or no sales in
 * the trailing year).
 */
export function historyFactor(monthly: Record<string, number>, month: string): number | null {
  const months = Object.keys(monthly).filter((k) => monthly[k] > 0).sort();
  if (!months.length || months[0] > shiftMonth(month, -MIN_HISTORY_MONTHS)) return null;
  const at = (m: string) => monthly[m] ?? 0;
  let trailing = 0;
  for (let i = 1; i <= 12; i++) trailing += at(shiftMonth(month, -i));
  const avg = trailing / 12;
  if (avg <= 0) return null;
  const ly = shiftMonth(month, -12);
  const lastYear = (at(shiftMonth(ly, -1)) + 2 * at(ly) + at(shiftMonth(ly, 1))) / 4;
  const raw = lastYear / avg;
  return clamp(1 + (raw - 1) * SMOOTHING);
}

/** Market seasonality: category name pattern, months (1-12) and multiplier, per country. Hints only; history wins. */
export type SeasonHint = { label: string; category: RegExp; months: number[]; factor: number };
const MALARIA = /malaria/i, COLD = /cough|cold|flu|respir/i, SCHOOL = /vitamin|supplement|first aid/i;
export const MARKET_SEASONS: Record<string, SeasonHint[]> = {
  GH: [
    { label: "Rainy season (malaria)", category: MALARIA, months: [4, 5, 6, 7, 9, 10], factor: 1.3 },
    { label: "Harmattan (coughs and colds)", category: COLD, months: [12, 1, 2], factor: 1.25 },
    { label: "Back to school", category: SCHOOL, months: [1, 9], factor: 1.15 },
  ],
  NG: [
    { label: "Rainy season (malaria)", category: MALARIA, months: [4, 5, 6, 7, 8, 9, 10], factor: 1.3 },
    { label: "Harmattan (coughs and colds)", category: COLD, months: [11, 12, 1, 2], factor: 1.25 },
    { label: "Back to school", category: SCHOOL, months: [1, 9], factor: 1.15 },
  ],
  KE: [
    { label: "Rainy season (malaria)", category: MALARIA, months: [3, 4, 5, 10, 11, 12], factor: 1.25 },
    { label: "Cold season (flu)", category: COLD, months: [6, 7, 8], factor: 1.2 },
    { label: "Back to school", category: SCHOOL, months: [1, 5, 9], factor: 1.15 },
  ],
};

/** Pure: the market hint that applies to a category in a country and month (1-12), if any (largest factor wins). */
export function marketHint(country: string, month: number, categoryName: string | null | undefined): SeasonHint | null {
  if (!categoryName) return null;
  const hits = (MARKET_SEASONS[country.toUpperCase()] ?? []).filter((h) => h.months.includes(month) && h.category.test(categoryName));
  return hits.sort((a, b) => b.factor - a.factor)[0] ?? null;
}

export type ForecastDetail = {
  productId: string; factor: number; source: "history" | "market" | "none"; label: string | null;
  lastYearSameMonth: number; monthlyAverage: number; last30Days: number;
};

/** Month the coming order is for: two weeks ahead, the middle of a typical lead time + cover window. */
export const forecastMonth = (today: string) => addDays(today, 14).slice(0, 7);

/** Per-product forecast detail for one branch (active products with any signal). */
export async function forecastDetails(t: Tx, tenant: { id: string; timezone: string; country: string }, branchId: string): Promise<ForecastDetail[]> {
  const tz = tenant.timezone;
  const today = localDay(tz);
  const month = forecastMonth(today);
  const since = dayRange(`${shiftMonth(month, -25)}-01`, tz).start;
  const since30 = dayRange(addDays(today, -30), tz).start;
  const rows = await t.select({
    productId: saleLines.productId,
    month: sql<string>`to_char(${sales.soldAt} at time zone ${tz}, 'YYYY-MM')`,
    n: sql<number>`sum(${saleLines.baseQty} - ${saleLines.returnedBaseQty})::int`,
    recent: sql<number>`coalesce(sum(${saleLines.baseQty} - ${saleLines.returnedBaseQty}) filter (where ${sales.soldAt} >= ${since30.toISOString()}), 0)::int`,
  }).from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(and(eq(sales.branchId, branchId), ne(sales.status, "voided"), gte(sales.soldAt, since)))
    .groupBy(saleLines.productId, sql`2`);
  const prods = await t.select({ id: products.id, category: categories.name }).from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId)).where(eq(products.active, true));

  const byProduct = new Map<string, { monthly: Record<string, number>; recent: number }>();
  for (const r of rows) {
    const e = byProduct.get(r.productId) ?? { monthly: {}, recent: 0 };
    e.monthly[r.month] = r.n;
    e.recent += r.recent;
    byProduct.set(r.productId, e);
  }
  const m = Number(month.slice(5));
  return prods.map((p) => {
    const h = byProduct.get(p.id) ?? { monthly: {}, recent: 0 };
    let trailing = 0;
    for (let i = 1; i <= 12; i++) trailing += h.monthly[shiftMonth(month, -i)] ?? 0;
    const base = { productId: p.id, lastYearSameMonth: h.monthly[shiftMonth(month, -12)] ?? 0, monthlyAverage: trailing / 12, last30Days: h.recent };
    const hf = historyFactor(h.monthly, month);
    if (hf !== null) return { ...base, factor: hf, source: "history" as const, label: "Last year's sales" };
    const hint = marketHint(tenant.country, m, p.category);
    if (hint) return { ...base, factor: hint.factor, source: "market" as const, label: hint.label };
    return { ...base, factor: 1, source: "none" as const, label: null };
  });
}

/** productId -> demand multiplier for the reorder maths. Only products whose factor differs from 1. */
export async function seasonalFactors(t: Tx, tenant: { id: string; timezone: string; country: string }, branchId: string): Promise<Map<string, number>> {
  return new Map((await forecastDetails(t, tenant, branchId)).filter((d) => d.factor !== 1).map((d) => [d.productId, d.factor]));
}
