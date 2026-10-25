/**
 * Expiry as printed on packs, typed fast: "03/27", "3/2027", "03-27", "2027-03", "2027-03-15", "15/03/2027".
 * Month-only dates mean the last day of that month (how manufacturers print them). Returns YYYY-MM-DD or null.
 */
export function parseExpiry(input: string): string | null {
  const s = input.trim().replace(/\s+/g, "");
  if (!s) return null;
  let y: number, m: number, d: number | null = null;
  let r: RegExpMatchArray | null;
  if ((r = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) [y, m, d] = [+r[1], +r[2], r[3] ? +r[3] : null];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) [d, m, y] = [+r[1], +r[2], +r[3]];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{2}|\d{4})$/))) [m, y] = [+r[1], +r[2]];
  else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d === null) d = last;
  if (d < 1 || d > last) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const daysUntil = (today: string, day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000);
