import type { Tone } from "@/components/ui";

export const PO_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "gray" }, sent: { label: "Sent", tone: "blue" }, confirmed: { label: "Confirmed", tone: "teal" },
  partially_received: { label: "Part received", tone: "yellow" }, received: { label: "Received", tone: "green" }, cancelled: { label: "Cancelled", tone: "red" },
};

export const RETURN_STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Awaiting credit", tone: "yellow" }, credited: { label: "Credited", tone: "green" },
  partially_credited: { label: "Part credited", tone: "blue" }, rejected: { label: "Rejected", tone: "red" },
};

/** Base units shown as packs + loose units, e.g. "3 box of 100 + 20 tablet". */
export function packs(base: number, unit: { name: string; factor: number }, baseUnit: string) {
  if (unit.factor <= 1) return `${base} ${baseUnit}`;
  const whole = Math.floor(base / unit.factor), loose = base % unit.factor;
  return [whole ? `${whole} × ${unit.name}` : "", loose ? `${loose} ${baseUnit}` : ""].filter(Boolean).join(" + ") || `0 ${baseUnit}`;
}

/** "48.00" -> 4800; null when not a valid amount. */
export const toMinor = (s: string) => (/^\d+(\.\d{1,2})?$/.test(s.trim()) ? Math.round(Number(s) * 100) : null);
