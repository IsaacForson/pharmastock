"use server";
import { and, eq, ne, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { audit, AuthError, getCtx, tx } from "@/lib/auth";
import { hashPassword, newTotpSecret, verifyPassword, verifyTotp } from "@/lib/crypto";
import { e164 } from "@/lib/format";

// Own-account changes need no role permission and stay available on read-only accounts.
async function me() {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("Your session has expired. Please sign in again.");
  if (ctx.impersonatedBy) throw new AuthError("Support view is read-only.");
  return ctx;
}

const signOutOthers = (userId: string, keep: string) => adminDb().delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, keep)));

export async function updateMyProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    const o = z.object({ name: z.string().min(2, "Name is required"), email: z.string().email().optional(), phone: z.string().optional() }).parse(formObject(fd));
    const email = o.email?.toLowerCase() ?? null, phone = e164(o.phone, ctx.tenant.country);
    if (!email && !phone) throw new UserError("Keep an email or phone number to sign in with");
    const conds = [email ? eq(users.email, email) : undefined, phone ? eq(users.phone, phone) : undefined].filter(Boolean);
    const [taken] = await adminDb().select({ id: users.id }).from(users).where(and(or(...conds), ne(users.id, ctx.user.id))).limit(1);
    if (taken) throw new UserError("That email or phone number is already used by another account");
    await tx(ctx, async (t) => {
      await t.update(users).set({ name: o.name, email, phone }).where(eq(users.id, ctx.user.id));
      await audit(t, ctx, "update", "user", ctx.user.id, { details: { self: true } });
    });
    revalidatePath("/account");
    return { ok: true, message: "Profile saved." };
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    const o = z.object({ current: z.string().min(1, "Enter your current password"), next: z.string().min(8, "New password must be at least 8 characters"), confirm: z.string() })
      .refine((v) => v.next === v.confirm, "The new passwords don't match").parse(formObject(fd));
    if (!(await verifyPassword(o.current, ctx.user.passwordHash))) throw new UserError("Current password is incorrect");
    const passwordHash = await hashPassword(o.next);
    await tx(ctx, async (t) => {
      await t.update(users).set({ passwordHash }).where(eq(users.id, ctx.user.id));
      await audit(t, ctx, "change_password", "user", ctx.user.id);
    });
    await signOutOthers(ctx.user.id, ctx.sessionId);
    return { ok: true, message: "Password changed. Other devices were signed out." };
  });
}

export async function startTotpAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    if (ctx.user.totpEnabled) throw new UserError("Two-factor authentication is already on");
    await tx(ctx, (t) => t.update(users).set({ totpSecret: newTotpSecret() }).where(eq(users.id, ctx.user.id)));
    revalidatePath("/account");
  });
}

export async function confirmTotpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    const code = z.string().regex(/^\d{6}$/, "Enter the 6-digit code").parse(formObject(fd).code);
    if (ctx.user.totpEnabled || !ctx.user.totpSecret) throw new UserError("Start setup first");
    if (!verifyTotp(ctx.user.totpSecret, code)) throw new UserError("That code didn't match. Check your phone's clock and try the newest code.");
    await tx(ctx, async (t) => {
      await t.update(users).set({ totpEnabled: true }).where(eq(users.id, ctx.user.id));
      await audit(t, ctx, "enable_2fa", "user", ctx.user.id);
    });
    revalidatePath("/account");
    return { ok: true, message: "Two-factor authentication is on." };
  });
}

export async function disableTotpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    const code = z.string().regex(/^\d{6}$/, "Enter the 6-digit code").parse(formObject(fd).code);
    if (!ctx.user.totpEnabled || !ctx.user.totpSecret) throw new UserError("Two-factor authentication is not on");
    if (!verifyTotp(ctx.user.totpSecret, code)) throw new UserError("Incorrect code");
    await tx(ctx, async (t) => {
      await t.update(users).set({ totpEnabled: false, totpSecret: null }).where(eq(users.id, ctx.user.id));
      await audit(t, ctx, "disable_2fa", "user", ctx.user.id);
    });
    revalidatePath("/account");
    return { ok: true, message: "Two-factor authentication is off." };
  });
}

export async function signOutOthersAction(_: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    await signOutOthers(ctx.user.id, ctx.sessionId);
    await tx(ctx, (t) => audit(t, ctx, "logout_others", "user", ctx.user.id));
    revalidatePath("/account");
    return { ok: true, message: "Signed out of all other devices." };
  });
}

/** Own counter PIN. Needs the current password so a PIN can't be set from an unattended, signed-in till. */
export async function setMyPinAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await me();
    const o = z.object({ pin: z.string().regex(/^\d{4,6}$/, "The PIN is 4 to 6 digits"), password: z.string().min(1, "Enter your password") }).parse(formObject(fd));
    if (/^(\d)\1+$/.test(o.pin) || "0123456789".includes(o.pin) || "9876543210".includes(o.pin)) throw new UserError("Pick a PIN that isn't a repeated or straight run of digits");
    if (!(await verifyPassword(o.password, ctx.user.passwordHash))) throw new UserError("Password is incorrect");
    const pinHash = await hashPassword(o.pin);
    await tx(ctx, async (t) => {
      await t.update(users).set({ pinHash }).where(eq(users.id, ctx.user.id));
      await audit(t, ctx, "set_pin", "user", ctx.user.id, { details: { self: true } });
    });
    revalidatePath("/account");
    return { ok: true, message: "PIN saved." };
  });
}
