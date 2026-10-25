// Pure helpers shared by report pages, the CSV route and the dashboard (no DB, unit-tested).
import { addDays, dayRange, localDay } from "@/lib/format";

export const PRESETS = {
  today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days",
  last90: "Last 90 days", thisMonth: "This month", lastMonth: "Last month", last12m: "Last 12 months", thisYear: "This year",
} as const;
export type Preset = keyof typeof PRESETS;

export type Range = { from: string; to: string; preset: Preset | "custom"; start: Date; end: Date };

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const MAX_DAYS = 731;

export function presetDays(p: Preset, today: string): [string, string] {
  const month = today.slice(0, 7);
  switch (p) {
    case "today": return [today, today];
    case "yesterday": return [addDays(today, -1), addDays(today, -1)];
    case "last7": return [addDays(today, -6), today];
    case "last30": return [addDays(today, -29), today];
    case "last90": return [addDays(today, -89), today];
    case "last12m": { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 11); return [d.toISOString().slice(0, 10), today]; }
    case "thisMonth": return [`${month}-01`, today];
    case "lastMonth": { const end = addDays(`${month}-01`, -1); return [`${end.slice(0, 7)}-01`, end]; }
    case "thisYear": return [`${today.slice(0, 4)}-01-01`, today];
  }
}

/** Resolves ?preset= / ?from=&to= into local days plus UTC [start, end) instants in the pharmacy timezone. */
export function resolveRange(sp: Record<string, string | string[] | undefined>, tz: string, now = new Date(), fallback: Preset = "last30"): Range {
  const today = localDay(tz, now);
  let from: string, to: string, preset: Range["preset"];
  if (isDay(sp.from) && isDay(sp.to)) {
    [from, to, preset] = sp.from <= sp.to ? [sp.from, sp.to, "custom"] : [sp.to, sp.from, "custom"];
    if (daysBetween(from, to).length > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  } else {
    preset = typeof sp.preset === "string" && sp.preset in PRESETS ? (sp.preset as Preset) : fallback;
    [from, to] = presetDays(preset, today);
  }
  return { from, to, preset, start: dayRange(from, tz).start, end: dayRange(to, tz).end };
}

/** Every local day from..to inclusive, so charts show zero days too. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Fills a day->value map into a dense series. */
export const denseSeries = (from: string, to: string, values: Map<string, number>) =>
  daysBetween(from, to).map((day) => ({ day, value: values.get(day) ?? 0 }));

export const AGING_BUCKETS = ["0–30 days", "31–60 days", "61–90 days", "90+ days"] as const;
export function agingBucket(ageDays: number): (typeof AGING_BUCKETS)[number] {
  if (ageDays <= 30) return AGING_BUCKETS[0];
  if (ageDays <= 60) return AGING_BUCKETS[1];
  if (ageDays <= 90) return AGING_BUCKETS[2];
  return AGING_BUCKETS[3];
}

/** RFC 4180 CSV. Cells starting with = + - @ are prefixed so spreadsheets don't run them as formulas. */
export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const pct = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 10 : 0);
