export function money(minor: number | null | undefined, currency = "GHS") {
  const v = (minor ?? 0) / 100;
  try {
    // Natural decimals per currency: GHS 12.50, UGX 12,500, XOF 1 250.
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}

/** Plain number for inputs, e.g. 1250 -> "12.50". */
export const toMajor = (minor: number | null | undefined) => ((minor ?? 0) / 100).toFixed(2);

export function dateTime(d: Date | string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }).format(new Date(d));
}
export const dateOnly = (d: Date | string | null | undefined, tz: string) => dateTime(d, tz, { dateStyle: "medium" });
export const timeOnly = (d: Date | string | null | undefined, tz: string) => dateTime(d, tz, { timeStyle: "short" });

/** YYYY-MM-DD for "today" in the pharmacy's timezone. */
export function localDay(tz: string, at: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** UTC instant for a local wall-clock date+time in tz (e.g. "2026-10-24", "14:30"). */
export function zonedToUtc(day: string, time: string, tz: string): Date {
  const naive = new Date(`${day}T${time.length === 5 ? time + ":00" : time}Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(naive);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(naive.getTime() - (asLocal - naive.getTime()));
}

/** Start/end UTC instants of a local day. */
export const dayRange = (day: string, tz: string) => ({ start: zonedToUtc(day, "00:00", tz), end: zonedToUtc(addDays(day, 1), "00:00", tz) });

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function age(dob: string | null | undefined, today = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  let y = today.getFullYear() - d.getFullYear();
  if (today < new Date(today.getFullYear(), d.getMonth(), d.getDate())) y--;
  if (y >= 2) return `${y}y`;
  const m = (today.getFullYear() - d.getFullYear()) * 12 + today.getMonth() - d.getMonth() - (today.getDate() < d.getDate() ? 1 : 0);
  return `${Math.max(m, 0)}m`;
}

/** Normalise a phone number to E.164 using the pharmacy's country calling code. */
const CALLING: Record<string, string> = { GH: "233", NG: "234", KE: "254", UG: "256", TZ: "255", RW: "250", ZA: "27", CI: "225", SN: "221", CM: "237", ZM: "260", US: "1", GB: "44" };
export function e164(phone: string | null | undefined, country = "GH"): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return "+" + digits.slice(2);
  const cc = CALLING[country] ?? "";
  return "+" + cc + digits.replace(/^0/, "");
}
