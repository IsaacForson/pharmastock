import { eq, sql } from "drizzle-orm";
import { adminDb } from "@/db";
import { branches, categories, messageTemplates, tenants, users } from "@/db/schema";
import { hashPassword } from "./crypto";
import { DEFAULT_TEMPLATES } from "./messaging";
import { TRIAL_DAYS } from "./plans";
import { COUNTRIES } from "./countries";

export { COUNTRIES } from "./countries";

const STARTER_CATEGORIES = [
  "Analgesics", "Antibiotics", "Antimalarials", "Antihypertensives", "Antidiabetics", "Cough & cold", "Vitamins & supplements",
  "Gastro-intestinal", "Dermatology", "Eye & ear", "Women's health", "Baby & child", "First aid", "Medical devices", "Personal care",
];

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pharmacy";
}

export async function provisionTenant(o: { pharmacyName: string; country: string; ownerName: string; email?: string; phone?: string; password: string }) {
  const c = COUNTRIES[o.country] ?? COUNTRIES.GH;
  const passwordHash = await hashPassword(o.password);
  return adminDb().transaction(async (t) => {
    const [tenant] = await t.insert(tenants).values({
      name: o.pharmacyName, slug: `${slugify(o.pharmacyName)}-${Math.random().toString(36).slice(2, 7)}`,
      country: o.country, currency: c.currency, timezone: c.timezone, phone: o.phone, email: o.email,
      plan: "pro", planStatus: "trialing", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000),
    }).returning();
    await t.insert(branches).values({ tenantId: tenant.id, name: "Main branch", isMain: true, phone: o.phone });
    const [owner] = await t.insert(users).values({
      tenantId: tenant.id, name: o.ownerName.trim(), email: o.email?.toLowerCase() || null, phone: o.phone || null,
      passwordHash, role: "owner", maxDiscountBp: 10_000,
    }).returning();
    await t.insert(categories).values(STARTER_CATEGORIES.map((name) => ({ tenantId: tenant.id, name })));
    await t.insert(messageTemplates).values(Object.entries(DEFAULT_TEMPLATES).map(([key, body]) => ({ tenantId: tenant.id, key, body })));
    return { tenant, owner };
  });
}

/** Deletes a whole pharmacy account (cascade). Lifts the controlled-register guard for this tenant only. */
export async function purgeTenant(tenantId: string) {
  await adminDb().transaction(async (t) => {
    await t.execute(sql`select set_config('app.purge_tenant', ${tenantId}, true)`);
    await t.delete(tenants).where(eq(tenants.id, tenantId));
  });
}
