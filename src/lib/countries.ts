/** Supported countries with their default currency and timezone (a pharmacy's currency defaults from its country). */
export const COUNTRIES: Record<string, { name: string; currency: string; timezone: string }> = {
  GH: { name: "Ghana", currency: "GHS", timezone: "Africa/Accra" },
  NG: { name: "Nigeria", currency: "NGN", timezone: "Africa/Lagos" },
  KE: { name: "Kenya", currency: "KES", timezone: "Africa/Nairobi" },
  UG: { name: "Uganda", currency: "UGX", timezone: "Africa/Kampala" },
  TZ: { name: "Tanzania", currency: "TZS", timezone: "Africa/Dar_es_Salaam" },
  RW: { name: "Rwanda", currency: "RWF", timezone: "Africa/Kigali" },
  ZA: { name: "South Africa", currency: "ZAR", timezone: "Africa/Johannesburg" },
  ZM: { name: "Zambia", currency: "ZMW", timezone: "Africa/Lusaka" },
  CI: { name: "Côte d'Ivoire", currency: "XOF", timezone: "Africa/Abidjan" },
  SN: { name: "Senegal", currency: "XOF", timezone: "Africa/Dakar" },
  CM: { name: "Cameroon", currency: "XAF", timezone: "Africa/Douala" },
  GB: { name: "United Kingdom", currency: "GBP", timezone: "Europe/London" },
  US: { name: "United States", currency: "USD", timezone: "America/New_York" },
};

export const CURRENCIES = [...new Set(Object.values(COUNTRIES).map((c) => c.currency))];
export const CURRENCY_NAMES: Record<string, string> = {
  GHS: "Ghana cedi", NGN: "Nigerian naira", KES: "Kenyan shilling", UGX: "Ugandan shilling", TZS: "Tanzanian shilling", RWF: "Rwandan franc",
  ZAR: "South African rand", ZMW: "Zambian kwacha", XOF: "West African CFA franc", XAF: "Central African CFA franc", GBP: "British pound", USD: "US dollar",
};

/** Currency for an ISO country code (e.g. from a CDN geo header); USD when unknown. */
export const currencyForCountry = (country: string | null | undefined) => COUNTRIES[(country ?? "").toUpperCase()]?.currency ?? "USD";

/** Visitor country from common CDN/host geo headers (Cloudflare, Vercel, Fly, generic). */
export function countryFromHeaders(h: Headers): string | null {
  const v = h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? h.get("fly-client-country") ?? h.get("x-country-code");
  return v && /^[A-Z]{2}$/i.test(v) && v.toUpperCase() !== "XX" ? v.toUpperCase() : null;
}
