import "server-only";
import type { PlatformAdmin } from "@/db/schema";
import { visitorCurrency } from "@/lib/currency";
import { money } from "@/lib/format";
import { moneyCtx } from "@/lib/platform-metrics";

/** The admin's display currency: their saved choice, else the currency of the country they're browsing from. */
export async function adminCurrency(admin: Pick<PlatformAdmin, "currency">) {
  return admin.currency ?? (await visitorCurrency());
}

/** Money context + formatter for a Control page. */
export async function controlMoney(admin: Pick<PlatformAdmin, "currency">) {
  const display = await adminCurrency(admin);
  const m = await moneyCtx(display);
  const fmt = (minor: number) => money(minor, display);
  return { m, fmt, display };
}
