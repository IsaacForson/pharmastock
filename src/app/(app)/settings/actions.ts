"use server";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { branches, documents, tenants } from "@/db/schema";
import { formObject, run, UserError, zBool, zMoney, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx } from "@/lib/auth";
import { COUNTRIES, CURRENCIES } from "@/lib/countries";
import { e164 } from "@/lib/format";
import { parseHoursForm } from "@/lib/hours";
import { hasFeature } from "@/lib/plans";
import { putFile } from "@/lib/storage";
import { assertSeats, syncBilledBranches } from "./limits";
import { parseAlertDays, percentToBp } from "./rules";

const profileSchema = z.object({
  name: z.string().min(2, "Pharmacy name is required").max(120),
  phone: z.string().optional(), email: z.string().email().optional(), address: z.string().max(300).optional(),
  licenceNo: z.string().max(80).optional(), superintendent: z.string().max(120).optional(), superintendentRegNo: z.string().max(80).optional(),
  taxId: z.string().max(80).optional(), letterhead: z.string().max(500).optional(), receiptFooter: z.string().max(500).optional(),
  country: z.string().refine((c) => c in COUNTRIES, "Choose a country"),
  currency: z.enum(CURRENCIES as [string, ...string[]], { message: "Choose a supported currency" }),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf("timeZone").includes(tz), "Choose a valid timezone"),
});

export async function updateProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const o = profileSchema.parse(formObject(fd));
    const logo = fd.get("logo");
    let logoKey: string | null = null;
    if (logo instanceof File && logo.size > 0) {
      if (!/^image\/(png|jpe?g|webp)$/.test(logo.type)) throw new UserError("Logo must be a PNG, JPG or WebP image");
      if (logo.size > 2 * 1024 * 1024) throw new UserError("Logo must be smaller than 2 MB");
      logoKey = await putFile(ctx.tenant.id, logo.name, Buffer.from(await logo.arrayBuffer()), logo.type);
    }
    await tx(ctx, async (t) => {
      let logoUrl: string | undefined;
      if (logoKey) {
        const f = logo as File;
        const [d] = await t.insert(documents).values({ tenantId: ctx.tenant.id, entity: "logo", name: f.name, mime: f.type, size: f.size, storageKey: logoKey, uploadedBy: ctx.user.id }).returning({ id: documents.id });
        logoUrl = `/api/files/${d.id}`;
      }
      const row = {
        name: o.name, phone: e164(o.phone, o.country), email: o.email ?? null, address: o.address ?? null, licenceNo: o.licenceNo ?? null,
        superintendent: o.superintendent ?? null, superintendentRegNo: o.superintendentRegNo ?? null, taxId: o.taxId ?? null,
        letterhead: o.letterhead ?? null, receiptFooter: o.receiptFooter ?? null, country: o.country, currency: o.currency, timezone: o.timezone,
      };
      await t.update(tenants).set({ ...row, ...(logoUrl ? { logoUrl } : {}) }).where(eq(tenants.id, ctx.tenant.id));
      await audit(t, ctx, "update", "tenant", ctx.tenant.id, { details: { section: "profile" } });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Pharmacy profile saved." };
  });
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 21:30");
const rulesSchema = z.object({
  pricesIncludeTax: zBool, defaultTax: z.string().optional(),
  expiryAlertDays: z.string().optional(), reorderCoverDays: z.coerce.number().int().min(3, "At least 3 days").max(180, "At most 180 days"),
  ownerSummaryEnabled: zBool, ownerSummaryTime: time, ownerSummaryTo: z.string().optional(),
  loyaltyEnabled: zBool, loyaltyEarnPerMajor: z.coerce.number().int().min(0).max(1000), loyaltyPointValue: zMoney.optional(),
  deliveryFee: zMoney.optional(),
});

/** Tax, stock alerts, owner summary, loyalty and delivery: the pharmacy-wide rules the till and nightly jobs follow. */
export async function saveRulesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const o = rulesSchema.parse(formObject(fd));
    let defaultTaxBp: number, expiryAlertDays: number[];
    try { defaultTaxBp = percentToBp(o.defaultTax ?? "0"); expiryAlertDays = parseAlertDays(o.expiryAlertDays ?? ""); } catch (e) { throw new UserError((e as Error).message); }
    const ownerSummaryTo = e164(o.ownerSummaryTo, ctx.tenant.country);
    if (o.ownerSummaryTo && !ownerSummaryTo) throw new UserError("Enter the WhatsApp number for the owner summary, e.g. 024 123 4567");
    const row = {
      pricesIncludeTax: o.pricesIncludeTax, defaultTaxBp, expiryAlertDays, reorderCoverDays: o.reorderCoverDays,
      ownerSummaryEnabled: o.ownerSummaryEnabled, ownerSummaryTime: o.ownerSummaryTime, ownerSummaryTo,
      loyaltyEnabled: o.loyaltyEnabled, loyaltyEarnPerMajor: o.loyaltyEarnPerMajor, loyaltyPointValueMinor: o.loyaltyPointValue ?? 0,
      deliveryFeeMinor: o.deliveryFee ?? 0,
    };
    if (row.loyaltyEnabled && (!row.loyaltyEarnPerMajor || !row.loyaltyPointValueMinor)) throw new UserError("Set how many points customers earn and what a point is worth, or switch loyalty off.");
    await tx(ctx, async (t) => {
      await t.update(tenants).set(row).where(eq(tenants.id, ctx.tenant.id));
      await audit(t, ctx, "update", "tenant", ctx.tenant.id, { details: { section: "rules", ...row } });
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Rules saved. The till and tonight's alerts use them from now on." };
  });
}

const branchSchema = z.object({
  id: z.string().uuid().optional(), name: z.string().min(1, "Branch name is required").max(120), address: z.string().max(300).optional(),
  phone: z.string().optional(), licenceNo: z.string().max(80).optional(), active: zBool,
});

export async function saveBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const o = branchSchema.parse(formObject(fd));
    const row = { name: o.name, address: o.address ?? null, phone: e164(o.phone, ctx.tenant.country), licenceNo: o.licenceNo ?? null };
    await tx(ctx, async (t) => {
      if (o.id) {
        const [b] = await t.select().from(branches).where(eq(branches.id, o.id));
        if (!b) throw new UserError("Branch not found");
        if (!o.active && b.isMain) throw new UserError("The main branch can't be deactivated. Make another branch main first.");
        if (o.active && !b.active) await assertSeats(t, ctx.tenant, { branches: 1 });
        await t.update(branches).set({ ...row, active: o.active }).where(eq(branches.id, o.id));
        await audit(t, ctx, "update", "branch", o.id, { details: { ...row, active: o.active } });
      } else {
        const existing = await t.select({ id: branches.id }).from(branches).where(eq(branches.active, true));
        if (existing.length && !hasFeature(ctx.tenant, "multi_branch")) throw new UserError("More than one branch is part of the Chain plan.");
        await assertSeats(t, ctx.tenant, { branches: 1 });
        const [b] = await t.insert(branches).values({ ...row, tenantId: ctx.tenant.id, isMain: existing.length === 0 }).returning({ id: branches.id });
        await audit(t, ctx, "create", "branch", b.id, { details: row });
      }
      await syncBilledBranches(t, ctx.tenant);
    });
    revalidatePath("/settings/branches");
    revalidatePath("/", "layout");
    return { ok: true, message: "Branch saved." };
  });
}

export async function saveOpeningHoursAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const f = formObject(fd);
    const id = z.string().uuid().parse(f.id);
    let hours;
    try { hours = parseHoursForm(f); } catch (e) { throw new UserError((e as Error).message); }
    await tx(ctx, async (t) => {
      const [b] = await t.update(branches).set({ openingHours: hours }).where(eq(branches.id, id)).returning({ id: branches.id });
      if (!b) throw new UserError("Branch not found");
      await audit(t, ctx, "update", "branch", id, { details: { openingHours: hours } });
    });
    revalidatePath("/settings/branches");
    return { ok: true, message: "Opening hours saved." };
  });
}

export async function makeMainBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("settings.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    await tx(ctx, async (t) => {
      const [b] = await t.select().from(branches).where(and(eq(branches.id, id), eq(branches.active, true)));
      if (!b) throw new UserError("Branch not found or inactive");
      await t.update(branches).set({ isMain: false }).where(ne(branches.id, id));
      await t.update(branches).set({ isMain: true }).where(eq(branches.id, id));
      await audit(t, ctx, "update", "branch", id, { details: { isMain: true } });
    });
    revalidatePath("/settings/branches");
  });
}
