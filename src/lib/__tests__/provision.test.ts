import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb } from "@/db";
import { branches, categories, messageTemplates, users } from "@/db/schema";
import { DEFAULT_TEMPLATES } from "../messaging";
import { purgeTenant, provisionTenant, slugify } from "../provision";
import { TRIAL_DAYS } from "../plans";

const created: string[] = [];
afterAll(async () => { for (const id of created) await purgeTenant(id); });

describe("provisionTenant", () => {
  it("sets currency and timezone from the country and starts a full trial", async () => {
    const stamp = Date.now();
    const { tenant, owner } = await provisionTenant({ pharmacyName: "Lagos Test Pharmacy", country: "NG", ownerName: "Ada Obi", email: `NG${stamp}@Test.local`, phone: `+23480${stamp % 100000000}`, password: "x".repeat(12) });
    created.push(tenant.id);
    expect(tenant.currency).toBe("NGN");
    expect(tenant.timezone).toBe("Africa/Lagos");
    expect(tenant.planStatus).toBe("trialing");
    expect(Math.round((tenant.trialEndsAt!.getTime() - Date.now()) / 86400_000)).toBe(TRIAL_DAYS);
    expect(owner.role).toBe("owner");
    expect(owner.email).toBe(`ng${stamp}@test.local`);
    expect(owner.maxDiscountBp).toBe(10_000);
    const [main] = await adminDb().select().from(branches).where(eq(branches.tenantId, tenant.id));
    expect(main.isMain).toBe(true);
    expect((await adminDb().select().from(categories).where(eq(categories.tenantId, tenant.id))).length).toBeGreaterThan(10);
    const tpls = await adminDb().select().from(messageTemplates).where(eq(messageTemplates.tenantId, tenant.id));
    expect(tpls.map((t) => t.key).sort()).toEqual(Object.keys(DEFAULT_TEMPLATES).sort());
  });

  it("purges every row of a tenant", async () => {
    const { tenant } = await provisionTenant({ pharmacyName: "Gone", country: "GH", ownerName: "X", email: `gone${Date.now()}@test.local`, password: "x".repeat(12) });
    await purgeTenant(tenant.id);
    expect(await adminDb().select().from(users).where(eq(users.tenantId, tenant.id))).toHaveLength(0);
  });

  it("makes URL-safe slugs", () => {
    expect(slugify("Ama's Pharmacy & Stores, Accra")).toBe("ama-s-pharmacy-stores-accra");
    expect(slugify("!!!")).toBe("pharmacy");
  });
});
