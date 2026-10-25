/** Pure parsers for the rules form (shared by the action and its tests). They throw Error with a user-facing message. */

/** "15" or "12.5" (%) -> basis points. */
export function percentToBp(s: string): number {
  const clean = s.replace("%", "").trim() || "0";
  if (!/^\d+(\.\d{1,2})?$/.test(clean) || Number(clean) > 100) throw new Error("Tax rate must be a percentage between 0 and 100, e.g. 15 or 12.5");
  return Math.round(Number(clean) * 100);
}

export const bpToPercent = (bp: number) => String(bp / 100);

/** "90, 60 30" -> [90, 60, 30]: unique whole days, longest first. */
export function parseAlertDays(s: string): number[] {
  const days = [...new Set(s.split(/[,\s]+/).filter(Boolean).map(Number))];
  if (!days.length) throw new Error("Add at least one expiry alert, e.g. 90, 60, 30");
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) throw new Error("Expiry alerts are whole days between 1 and 365, e.g. 90, 60, 30");
  if (days.length > 5) throw new Error("Up to 5 expiry alerts");
  return days.sort((a, b) => b - a);
}
