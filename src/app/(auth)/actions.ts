"use server";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminDb } from "@/db";
import { auditLog, otpCodes, sessions, tenants, users } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { createSession, destroySession, readSession } from "@/lib/auth";
import { sha256, verifyPassword, verifyTotp } from "@/lib/crypto";
import { e164 } from "@/lib/format";
import { sendNow } from "@/lib/messaging";
import { COUNTRIES, provisionTenant } from "@/lib/provision";

async function finishLogin(user: typeof users.$inferSelect, method: string) {
  const [t] = await adminDb().select({ suspendedAt: tenants.suspendedAt }).from(tenants).where(eq(tenants.id, user.tenantId));
  if (t?.suspendedAt) throw new UserError("This pharmacy account is suspended. Please contact PharmaStock support.");
  const needsMfa = user.totpEnabled;
  await createSession(user, needsMfa);
  await adminDb().insert(auditLog).values({ tenantId: user.tenantId, userId: user.id, action: "login", entity: "user", entityId: user.id, details: { method, mfa: needsMfa } });
  redirect(needsMfa ? "/login/2fa" : "/dashboard");
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const { login, password } = z.object({ login: z.string().min(3), password: z.string().min(1) }).parse(formObject(fd));
    const id = login.includes("@") ? login.toLowerCase() : e164(login)!;
    const [user] = await adminDb().select().from(users).where(or(eq(users.email, id), eq(users.phone, id))).limit(1);
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) throw new UserError("Incorrect email/phone or password.");
    await finishLogin(user, "password");
  });
}

export async function requestOtpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const phone = e164(z.string().min(6).parse(formObject(fd).phone))!;
    const [user] = await adminDb().select().from(users).where(eq(users.phone, phone)).limit(1);
    const recent = await adminDb().select().from(otpCodes).where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, new Date(Date.now() - 60_000)))).limit(1);
    if (recent.length) throw new UserError("Please wait a minute before requesting another code.");
    // Same response whether or not the number exists, so phone numbers can't be enumerated.
    if (user?.active) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await adminDb().insert(otpCodes).values({ phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + 10 * 60_000) });
      await sendNow({ tenantId: user.tenantId, channel: "sms", to: phone, body: `Your PharmaStock login code is ${code}. It expires in 10 minutes.` });
    }
    return { ok: true, message: "If that number is registered, a code has been sent by SMS." };
  });
}

export async function verifyOtpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const o = z.object({ phone: z.string().min(6), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(formObject(fd));
    const phone = e164(o.phone)!;
    const [otp] = await adminDb().select().from(otpCodes).where(and(eq(otpCodes.phone, phone), gt(otpCodes.expiresAt, new Date()))).orderBy(desc(otpCodes.createdAt)).limit(1);
    if (!otp || otp.attempts >= 5) throw new UserError("Code expired. Request a new one.");
    if (otp.codeHash !== sha256(`${phone}:${o.code}`)) {
      await adminDb().update(otpCodes).set({ attempts: otp.attempts + 1 }).where(eq(otpCodes.id, otp.id));
      throw new UserError("Incorrect code.");
    }
    await adminDb().delete(otpCodes).where(eq(otpCodes.phone, phone));
    const [user] = await adminDb().select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user?.active) throw new UserError("Account not found.");
    await finishLogin(user, "otp");
  });
}

export async function verify2faAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const code = z.string().regex(/^\d{6}$/, "Enter the 6-digit code").parse(formObject(fd).code);
    const s = await readSession();
    if (!s?.session.mfaPending) redirect("/login");
    if (!s.user.totpSecret || !verifyTotp(s.user.totpSecret, code)) throw new UserError("Incorrect code.");
    await adminDb().update(sessions).set({ mfaPending: false }).where(eq(sessions.id, s.session.id));
    await adminDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, s.user.id));
    redirect("/dashboard");
  });
}

export async function signupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const o = z.object({
      pharmacyName: z.string().trim().min(2, "Pharmacy name is required").max(120),
      ownerName: z.string().trim().min(2, "Your name is required").max(120),
      country: z.string().refine((c) => c in COUNTRIES, "Choose a country"),
      email: z.string().email("Enter a valid email").optional(),
      phone: z.string().min(6, "Enter a phone number").max(20).optional(),
      password: z.string().min(10, "Use at least 10 characters").max(200),
      terms: z.literal("on", { message: "Please accept the terms and privacy policy" }),
    }).parse(formObject(fd));
    const phone = e164(o.phone, o.country) ?? undefined;
    const email = o.email?.toLowerCase();
    if (!email && !phone) throw new UserError("Enter an email or a phone number to sign in with");
    const conds = [email ? eq(users.email, email) : undefined, phone ? eq(users.phone, phone) : undefined].filter(Boolean);
    const taken = await adminDb().select({ id: users.id }).from(users).where(or(...conds)).limit(1);
    if (taken.length) throw new UserError("An account with that email or phone already exists. Try signing in.");
    const { owner } = await provisionTenant({ pharmacyName: o.pharmacyName, country: o.country, ownerName: o.ownerName, email, phone, password: o.password });
    await finishLogin(owner, "signup");
  });
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
