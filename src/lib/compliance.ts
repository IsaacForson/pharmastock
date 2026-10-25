/**
 * Per-country rules and wording for pharmacy records. Launch markets: Ghana, Nigeria, Kenya; anything else falls back
 * to GENERIC. Tax rates are only suggested defaults: each product keeps its own rate (many medicines are zero-rated or
 * exempt), and the pharmacy confirms them with its accountant. Register layouts follow what inspectors ask for in each
 * market; confirm the current format with the regulator before relying on a printout.
 */
export type CountryRules = {
  regulator: string; // premises / pharmacist licensing body
  drugAuthority: string; // product registration and recalls
  registerTitle: string; // controlled-drug register heading
  scheduleLabels: Record<"otc" | "pharmacy" | "pom" | "controlled" | "non_drug", string>;
  /** Standard sales-tax rate in basis points, for non-exempt goods (cosmetics, devices, sundries). */
  standardTaxBp: number;
  taxName: string;
  /** Minimum years prescriptions and registers must be kept. */
  retentionYears: number;
  mobileMoney: string[];
  /** Phrases on POM receipts / labels. */
  labelWarning: string;
};

const SCHEDULES = { otc: "OTC", pharmacy: "Pharmacy only (P)", pom: "Prescription only (POM)", controlled: "Controlled drug", non_drug: "Non-drug" };

export const COUNTRY_RULES: Record<string, CountryRules> = {
  GH: {
    regulator: "Pharmacy Council, Ghana", drugAuthority: "Food and Drugs Authority (FDA Ghana)",
    registerTitle: "Register of Controlled Drugs (Narcotics & Psychotropics)",
    scheduleLabels: { ...SCHEDULES, otc: "OTC (Class C)", pharmacy: "Pharmacy medicine (Class B)", pom: "Prescription only (Class A)" },
    standardTaxBp: 2000, taxName: "VAT + levies", retentionYears: 5,
    mobileMoney: ["MTN MoMo", "Telecel Cash", "AT Money"], labelWarning: "Keep out of reach of children.",
  },
  NG: {
    regulator: "Pharmacy Council of Nigeria (PCN)", drugAuthority: "NAFDAC",
    registerTitle: "Dangerous Drugs Register",
    scheduleLabels: SCHEDULES,
    standardTaxBp: 750, taxName: "VAT", retentionYears: 5,
    mobileMoney: ["Bank transfer", "OPay", "Moniepoint", "PalmPay"], labelWarning: "Keep out of reach of children.",
  },
  KE: {
    regulator: "Pharmacy and Poisons Board (PPB)", drugAuthority: "Pharmacy and Poisons Board (PPB)",
    registerTitle: "Dangerous Drugs Register (Form DDA)",
    scheduleLabels: { ...SCHEDULES, otc: "GSL / OTC", pharmacy: "Pharmacy technologist (P)" },
    standardTaxBp: 1600, taxName: "VAT", retentionYears: 5,
    mobileMoney: ["M-Pesa", "Airtel Money"], labelWarning: "Keep out of reach of children.",
  },
};

export const GENERIC: CountryRules = {
  regulator: "Pharmacy regulator", drugAuthority: "Medicines regulator", registerTitle: "Controlled Drugs Register",
  scheduleLabels: SCHEDULES, standardTaxBp: 0, taxName: "Tax", retentionYears: 5, mobileMoney: ["Mobile money"],
  labelWarning: "Keep out of reach of children.",
};

export const rulesFor = (country: string | null | undefined): CountryRules => COUNTRY_RULES[(country ?? "").toUpperCase()] ?? GENERIC;

/** Schedules a cashier may not supply without a pharmacist on the sale. */
export const NEEDS_PHARMACIST = new Set(["pharmacy", "pom", "controlled"]);
/**
 * Schedules that need a prescription linked to the sale. POM is supervised by the pharmacist (who may supply against a
 * paper prescription they keep on file); controlled drugs always need a recorded prescription for the register.
 */
export const NEEDS_PRESCRIPTION = new Set(["controlled"]);
