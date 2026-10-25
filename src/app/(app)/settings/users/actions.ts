"use server";
import { and, eq, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminDb, type Tx } from "@/db";
import { sessions, users } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { audit, requireWrite, tx, type Ctx } from "@/lib/auth";
import { hashPassword, randomToken } from "@/lib/crypto";
import { e164 } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { assertSeats } from "../limits";

const ROLES = Object.keys(ROLE_LABELS) as [keyof typeof ROLE_LABELS, ...(keyof typeof ROLE_LABELS)[]];
const staffSchema = z.object({
  name: z.string().min(2, "Name is required").max(120), email: z.string().email().optional(), phone: z.string().optional(),
  role: z.enum(ROLES), regNo: z.string().max(60).optional(),
  maxDiscount: z.string().optional().transform((v, c) => {
    const n = Number(v ?? "0");
    if (!/^\d+(\.\d{1,2})?$/.test(v ?? "0") || n > 100) { c.addIssue({ code: "custom", message: "Largest discount is a percentage between 0 and 100" }); return z.NEVER; }
    return Math.round(n * 100);
  }),
}).refine((o) => o.role !== "pharmacist" || !!o.regNo, { message: "Enter the pharmacist's registration number", path: ["regNo"] });

/** Only an owner may create, change, deactivate or reset another owner (managers manage everyone else). */
function assertOwnerPower(ctx: Ctx, ...roles: (string | undefined)[]) {
  if (ctx.user.role !== "owner" && roles.includes("owner")) throw new UserError("Only the pharmacy owner can manage owner accounts.");
}

function contact(o: { email?: string; phone?: string }, country: string) {
  const email = o.email?.toLowerCase() ?? null, phone = e164(o.phone, country);
  if (!email && !phone) throw new UserError("Enter an email or a phone number they will sign in with");
  return { email, phone };
}

/** Email/phone are globally unique logins, so the check has to look across tenants (auth layer). */
async function assertLoginFree(email: string | null, phone: string | null, exceptId?: string) {
  const conds = [email ? eq(users.email, email) : undefined, phone ? eq(users.phone, phone) : undefined].filter(Boolean);
  const [hit] = await adminDb().select({ id: users.id }).from(users).where(and(or(...conds), exceptId ? ne(users.id, exceptId) : undefined)).limit(1);
  if (hit) throw new UserError("That email or phone number is already used by another account");
}

/** null = all branches. Only branches the owner can see are accepted. */
function branchIdsFrom(fd: FormData, ctx: Ctx) {
  const ids = fd.getAll("branchIds").map(String).filter((id) => ctx.branches.some((b) => b.id === id));
  return fd.get("allBranches") || ids.length === 0 ? null : ids;
}

const tempPassword = () => randomToken(9);

export async function addStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("users.manage");
    const o = staffSchema.parse(formObject(fd));
    const { email, phone } = contact(o, ctx.tenant.country);
    await assertLoginFree(email, phone);
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    const branchIds = branchIdsFrom(fd, ctx);
    assertOwnerPower(ctx, o.role);
    await tx(ctx, async (t) => {
      await assertSeats(t, ctx.tenant, { users: 1 });
      const [u] = await t.insert(users).values({
        tenantId: ctx.tenant.id, name: o.name, email, phone, role: o.role, regNo: o.regNo ?? null, maxDiscountBp: o.maxDiscount, branchIds, passwordHash,
      }).returning({ id: users.id });
      await audit(t, ctx, "create", "user", u.id, { details: { role: o.role, maxDiscountBp: o.maxDiscount, branchIds } });
    });
    revalidatePath("/settings/users");
    return { ok: true, message: `${o.name} added. Temporary password: ${password} — share it privately; it is shown only once. They can change it under My account.` };
  });
}

async function loadUser(t: Tx, id: string) {
  const [u] = await t.select().from(users).where(eq(users.id, id));
  if (!u) throw new UserError("Staff member not found");
  return u;
}

async function assertOtherOwner(t: Tx, exceptId: string) {
  const [other] = await t.select({ id: users.id }).from(users).where(and(eq(users.role, "owner"), eq(users.active, true), ne(users.id, exceptId))).limit(1);
  if (!other) throw new UserError("The pharmacy needs at least one active owner");
}

export async function updateStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("users.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const f = formObject(fd);
    const o = staffSchema.parse(f);
    const { email, phone } = contact(o, ctx.tenant.country);
    await assertLoginFree(email, phone, id);
    const branchIds = branchIdsFrom(fd, ctx);
    await tx(ctx, async (t) => {
      const u = await loadUser(t, id);
      assertOwnerPower(ctx, u.role, o.role);
      if (u.role === "owner" && o.role !== "owner") {
        if (u.id === ctx.user.id) throw new UserError("You can't remove your own owner role");
        await assertOtherOwner(t, u.id);
      }
      if (u.id === ctx.user.id && o.maxDiscount !== u.maxDiscountBp && ctx.user.role !== "owner") throw new UserError("Ask the owner to change your own discount limit");
      await t.update(users).set({ name: o.name, email, phone, role: o.role, regNo: o.regNo ?? null, maxDiscountBp: o.maxDiscount, branchIds }).where(eq(users.id, id));
      await audit(t, ctx, "update", "user", id, { details: {
        role: o.role, maxDiscountBp: o.maxDiscount, branchIds,
        before: { role: u.role, maxDiscountBp: u.maxDiscountBp, branchIds: u.branchIds },
      } });
    });
    revalidatePath("/settings/users");
    return { ok: true, message: "Saved." };
  });
}

export async function setStaffActiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("users.manage");
    const o = z.object({ id: z.string().uuid(), active: z.enum(["0", "1"]) }).parse(formObject(fd));
    const active = o.active === "1";
    if (!active && o.id === ctx.user.id) throw new UserError("You can't deactivate your own account");
    await tx(ctx, async (t) => {
      const u = await loadUser(t, o.id);
      assertOwnerPower(ctx, u.role);
      if (active && !u.active) await assertSeats(t, ctx.tenant, { users: 1 });
      if (!active && u.role === "owner") await assertOtherOwner(t, u.id);
      await t.update(users).set({ active }).where(eq(users.id, o.id));
      await audit(t, ctx, active ? "activate" : "deactivate", "user", o.id);
    });
    // Sessions are owner-only (auth layer); signing them out immediately.
    if (!active) await adminDb().delete(sessions).where(and(eq(sessions.userId, o.id), eq(sessions.tenantId, ctx.tenant.id)));
    revalidatePath("/settings/users");
  });
}

export async function resetStaffPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("users.manage");
    const id = z.string().uuid().parse(fd.get("id"));
    const password = tempPassword();
    const passwordHash = await hashPassword(password);
    const name = await tx(ctx, async (t) => {
      const u = await loadUser(t, id);
      assertOwnerPower(ctx, u.role);
      await t.update(users).set({ passwordHash }).where(eq(users.id, id));
      await audit(t, ctx, "reset_password", "user", id);
      return u.name;
    });
    await adminDb().delete(sessions).where(and(eq(sessions.userId, id), eq(sessions.tenantId, ctx.tenant.id), ne(sessions.id, ctx.sessionId)));
    return { ok: true, message: `New temporary password for ${name}: ${password} — shown only once. Their other sessions were signed out.` };
  });
}

/** Counter PIN (4–6 digits) for quick sign-off at a shared till, e.g. a pharmacist approving a P/POM sale. */
export async function setStaffPinAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("users.manage");
    const o = z.object({ id: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/, "The PIN is 4 to 6 digits").optional(), clear: z.string().optional() }).parse(formObject(fd));
    if (!o.clear && !o.pin) throw new UserError("Enter a 4 to 6 digit PIN");
    const pinHash = o.clear ? null : await hashPassword(o.pin!);
    const name = await tx(ctx, async (t) => {
      const u = await loadUser(t, o.id);
      assertOwnerPower(ctx, u.role);
      await t.update(users).set({ pinHash }).where(eq(users.id, o.id));
      await audit(t, ctx, o.clear ? "clear_pin" : "set_pin", "user", o.id);
      return u.name;
    });
    revalidatePath(`/settings/users/${o.id}`);
    return { ok: true, message: o.clear ? `${name}'s PIN was removed.` : `PIN set for ${name}. Tell them privately; it isn't shown again.` };
  });
}
