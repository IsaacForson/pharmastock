import { and, desc, eq, gt, gte, inArray, isNull, or } from "drizzle-orm";
import { barcodes, branches, customers, payers, productUnits, products, stockBatches, users } from "@/db/schema";
import { getCtx, tx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { localDay } from "@/lib/format";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { CATALOG_VERSION, type PosCatalog } from "@/lib/pos-catalog";

// shortcut: customer list is capped for the device copy; bigger pharmacies find older customers online. Upgrade to paging when a tenant passes it.
const CUSTOMER_CAP = 5000;

/** Compact snapshot of everything the till needs to sell with no connection, for the user's current branch. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx || !can(ctx.user.role, "pos.sell")) return Response.json({ error: "Sign in to use the till" }, { status: 401 });
  const tenant = ctx.tenant;
  const today = localDay(tenant.timezone);
  const rules = rulesFor(tenant.country);
  const data = await tx(ctx, async (t) => {
    const prods = await t.select().from(products).where(eq(products.active, true)).orderBy(products.name);
    const units = await t.select().from(productUnits).where(eq(productUnits.sellable, true));
    const codes = await t.select({ code: barcodes.code, productId: barcodes.productId, unitId: barcodes.unitId }).from(barcodes);
    const batches = await t.select({ id: stockBatches.id, productId: stockBatches.productId, batchNo: stockBatches.batchNo, expiry: stockBatches.expiry, qty: stockBatches.qtyOnHand })
      .from(stockBatches).where(and(eq(stockBatches.branchId, ctx.branchId), gt(stockBatches.qtyOnHand, 0), eq(stockBatches.quarantined, false), or(isNull(stockBatches.expiry), gte(stockBatches.expiry, today))));
    const custs = can(ctx.user.role, "customers.read")
      ? await t.select().from(customers).where(isNull(customers.deletedAt)).orderBy(desc(customers.createdAt)).limit(CUSTOMER_CAP) : [];
    const staff = await t.select({ id: users.id, name: users.name, role: users.role, branchIds: users.branchIds, pin: users.pinHash }).from(users)
      .where(and(eq(users.active, true), inArray(users.role, ["owner", "pharmacist"])));
    const pay = await t.select().from(payers).where(eq(payers.active, true)).orderBy(payers.name);
    const [branch] = await t.select().from(branches).where(eq(branches.id, ctx.branchId));
    return { prods, units, codes, batches, custs, staff, pay, branch };
  });
  const sellable = new Set(data.units.map((u) => u.id));
  const body: PosCatalog = {
    v: CATALOG_VERSION, builtAt: new Date().toISOString(), today, branchId: ctx.branchId,
    tenant: {
      name: tenant.name, branch: data.branch && !data.branch.isMain ? data.branch.name : null, address: data.branch?.address ?? tenant.address,
      phone: data.branch?.phone ?? tenant.phone, licenceNo: data.branch?.licenceNo ?? tenant.licenceNo, taxId: tenant.taxId, letterhead: tenant.letterhead,
      footer: tenant.receiptFooter, country: tenant.country, currency: tenant.currency, timezone: tenant.timezone, inclusive: tenant.pricesIncludeTax,
      defaultTaxBp: tenant.defaultTaxBp, taxName: rules.taxName, labelWarning: rules.labelWarning, mobileMoney: rules.mobileMoney,
      loyaltyEnabled: tenant.loyaltyEnabled && hasFeature(tenant, "loyalty"), pointValueMinor: tenant.loyaltyPointValueMinor, earnPerMajor: tenant.loyaltyEarnPerMajor,
      scheduleLabels: rules.scheduleLabels, controlledAllowed: hasFeature(tenant, "controlled"),
    },
    user: {
      id: ctx.user.id, name: ctx.user.name, canOverride: can(ctx.user.role, "pos.price_override"), canDiscount: can(ctx.user.role, "pos.discount"),
      canCredit: can(ctx.user.role, "pos.credit"), sellsPharmacy: can(ctx.user.role, "sell.pharmacy"), maxDiscountBp: ctx.user.maxDiscountBp,
    },
    products: data.prods.map((p) => ({
      id: p.id, name: p.name, generic: p.genericName, strength: p.strength, form: p.form, schedule: p.schedule, baseUnit: p.baseUnit, taxBp: p.taxBp,
      favorite: p.favorite, shelf: p.shelf,
      units: data.units.filter((u) => u.productId === p.id).sort((a, b) => a.factor - b.factor)
        .map((u) => ({ id: u.id, name: u.name, factor: u.factor, priceMinor: u.sellPriceMinor, isDefault: u.isDefault })),
    })).filter((p) => p.units.length),
    barcodes: data.codes.filter((c) => sellable.has(c.unitId)).map((c) => [c.code, c.productId, c.unitId]),
    batches: data.batches,
    customers: data.custs.map((c) => ({
      id: c.id, name: c.name, customerNo: c.customerNo, phone: c.phone, balanceMinor: c.balanceMinor, creditLimitMinor: c.creditLimitMinor,
      points: c.loyaltyPoints, payerId: c.payerId, memberNo: c.memberNo, consent: c.messagingConsent && !c.optedOutAt,
    })),
    // Pharmacists who can approve supervised items at this branch (and have a counter PIN set).
    pharmacists: data.staff.filter((s) => s.pin && can(s.role, "sell.pharmacy") && (!s.branchIds?.length || s.branchIds.includes(ctx.branchId))).map((s) => ({ id: s.id, name: s.name })),
    payers: data.pay.map((p) => ({ id: p.id, name: p.name, coverageBp: p.coverageBp })),
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
