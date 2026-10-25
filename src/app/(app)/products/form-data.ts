import { asc, eq } from "drizzle-orm";
import { categories, suppliers } from "@/db/schema";
import { tx, type Ctx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { can } from "@/lib/permissions";
import type { Tone } from "@/components/ui";

export const SCHEDULE_TONE: Record<string, Tone> = { otc: "green", pharmacy: "blue", pom: "yellow", controlled: "red", non_drug: "gray" };

/** Options every product form needs. */
export async function formOptions(ctx: Ctx) {
  const [cats, sups] = await tx(ctx, (t) => Promise.all([
    t.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    t.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.name)),
  ]));
  return {
    categories: cats, suppliers: sups, scheduleLabels: rulesFor(ctx.tenant.country).scheduleLabels,
    canPrice: can(ctx.user.role, "prices.write"), defaultTaxPercent: String(ctx.tenant.defaultTaxBp / 100),
  };
}
