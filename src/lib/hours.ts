import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/db/schema";

export { DEFAULT_OPENING_HOURS, type OpeningHours };
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
type DayKey = keyof OpeningHours;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toMinutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/** Weekday key of a local calendar date "YYYY-MM-DD". */
export const weekdayOf = (day: string) => String(new Date(`${day}T12:00:00Z`).getUTCDay()) as DayKey;

/** [open, close] for that calendar date, or null when the branch is closed. */
export function hoursOn(hours: OpeningHours | null | undefined, day: string): [string, string] | null {
  return (hours ?? DEFAULT_OPENING_HOURS)[weekdayOf(day)] ?? null;
}

/** Whether [startMin, endMin) (minutes after local midnight) fits inside the day's opening hours. */
export function withinHours(hours: OpeningHours | null | undefined, day: string, startMin: number, endMin: number): boolean {
  const h = hoursOn(hours, day);
  return !!h && startMin >= toMinutes(h[0]) && endMin <= toMinutes(h[1]);
}

export const describeHours = (h: [string, string] | null) => (h ? `${h[0]}–${h[1]}` : "closed");

/** Parses form fields open_0..open_6 / close_0..close_6 / closed_0..closed_6 into OpeningHours (throws a readable message). */
export function parseHoursForm(f: Record<string, string | undefined>): OpeningHours {
  const out = {} as OpeningHours;
  for (let d = 0; d < 7; d++) {
    const k = String(d) as DayKey;
    if (f[`closed_${d}`] === "on") { out[k] = null; continue; }
    const open = f[`open_${d}`], close = f[`close_${d}`];
    if (!open || !close || !TIME.test(open) || !TIME.test(close)) throw new Error(`${WEEKDAYS[d]}: enter opening and closing times (HH:MM) or tick Closed`);
    if (toMinutes(close) <= toMinutes(open)) throw new Error(`${WEEKDAYS[d]}: closing time must be after opening time`);
    out[k] = [open, close];
  }
  return out;
}
