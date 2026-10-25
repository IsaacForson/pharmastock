import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { cache } from "react";
import { adminDb } from "@/db";
import { fxRates, priceBook } from "@/db/schema";
import { countryFromHeaders, currencyForCountry } from "./countries";
import { DEFAULT_PER_USD, PAYSTACK_CURRENCIES, priceListFor, type PriceList, type Rates } from "./money";

/** Current exchange rates (DB, falling back to defaults). Cached per request. */
export const getRates = cache(async (): Promise<Rates> => {
  const rows = await adminDb().select().from(fxRates);
  return { ...DEFAULT_PER_USD, ...Object.fromEntries(rows.map((r) => [r.currency, r.perUsd])) };
});

/** Subscription price list for a currency: the team's custom local prices, or converted USD list prices. */
export const getPriceList = cache(async (currency: string): Promise<PriceList> => {
  const [custom] = await adminDb().select().from(priceBook).where(eq(priceBook.currency, currency));
  return priceListFor(currency, await getRates(), custom ?? null);
});

/** Currency of the person viewing (from the CDN's country header); USD when unknown. */
export async function visitorCurrency(): Promise<string> {
  return currencyForCountry(countryFromHeaders(await headers()));
}

/**
 * What a pharmacy sees and pays for its subscription and setup service: prices in the pharmacy's currency, charged in
 * that currency when Paystack supports it, otherwise charged in USD at the USD list price (local figures are then estimates).
 */
export async function pharmacyBilling(currency: string) {
  const display = await getPriceList(currency);
  const chargeable = PAYSTACK_CURRENCIES.has(currency);
  const charge = chargeable ? display : await getPriceList("USD");
  return { display, charge, chargeable };
}
