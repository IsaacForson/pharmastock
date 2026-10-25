import { cookies } from "next/headers";
import { cache, Suspense } from "react";
import { CURRENCIES } from "@/lib/countries";
import { getPriceList, visitorCurrency } from "@/lib/currency";
import { money } from "@/lib/format";
import { priceListFor, type PriceList, type SetupKey } from "@/lib/money";
import type { PlanKey } from "@/lib/plans";
import { CurrencySwitcher } from "./currency-switcher";

export const CURRENCY_COOKIE = "ps-currency";

/** Visitor's currency: their own choice (cookie set by the switcher), else their country's currency. */
export const visitorPrices = cache(async (): Promise<PriceList> => {
  const chosen = (await cookies()).get(CURRENCY_COOKIE)?.value;
  const currency = chosen && CURRENCIES.includes(chosen) ? chosen : await visitorCurrency();
  return getPriceList(currency);
});

/** Plan prices are per month (Chain: per branch per month). */
export type PriceOf =
  | { plan: PlanKey; cycle?: "monthly" | "annual" | "annual-saving" }
  | { setup: SetupKey };

function pick(list: PriceList, of: PriceOf) {
  if ("plan" in of) {
    const m = list.plans[of.plan];
    return of.cycle === "annual" ? m * 10 : of.cycle === "annual-saving" ? m * 2 : m;
  }
  return list.setup[of.setup];
}

async function Resolved({ of }: { of: PriceOf }) {
  const list = await visitorPrices();
  return <>{money(pick(list, of), list.currency)}</>;
}

/** A price in the visitor's currency. The static shell shows the USD price until the visitor's currency streams in. */
export function Price({ of }: { of: PriceOf }) {
  const usd = priceListFor("USD", { USD: 1 });
  return <Suspense fallback={<>{money(pick(usd, of), "USD")}</>}><Resolved of={of} /></Suspense>;
}


async function SwitcherInner() {
  const list = await visitorPrices();
  return <CurrencySwitcher current={list.currency} />;
}
/** Currency picker showing the visitor's current currency. */
export function PriceCurrencySwitcher() {
  return <Suspense fallback={null}><SwitcherInner /></Suspense>;
}
