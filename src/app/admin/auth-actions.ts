"use server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminDb } from "@/db";
import { platformAdmins, platformSessions } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { verifyPassword, verifyTotp } from "@/lib/crypto";
import { createPlatformSession, destroyPlatformSession, platformLog, readPlatformSession } from "@/lib/platform-auth";

export async function adminLoginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const o = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(formObject(fd));
    const [admin] = await adminDb().select().from(platformAdmins).where(eq(platformAdmins.email, o.email.toLowerCase())).limit(1);
    if (!admin || !admin.active || !(await verifyPassword(o.password, admin.passwordHash))) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      if (admin) await platformLog({ admin: { id: admin.id }, ip: null }, "login_failed", { entity: "platform_admin", entityId: admin.id });
      throw new UserError("Incorrect email or password.");
    }
    await createPlatformSession(admin);
    redirect("/admin/2fa");
  });
}

/** Second step: verify an enrolled authenticator, or finish first-time enrolment (2FA is mandatory). */
export async function adminVerify2faAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const code = z.string().regex(/^\d{6}$/, "Enter the 6-digit code").parse(formObject(fd).code);
    const s = await readPlatformSession();
    if (!s) redirect("/admin/login");
    if (!s.admin.totpSecret || !verifyTotp(s.admin.totpSecret, code)) {
      await platformLog({ admin: { id: s.admin.id }, ip: s.session.ip }, "mfa_failed");
      throw new UserError("Incorrect code.");
    }
    const enrolling = !s.admin.totpEnabled;
    await adminDb().update(platformAdmins).set({ totpEnabled: true, lastLoginAt: new Date() }).where(eq(platformAdmins.id, s.admin.id));
    await adminDb().update(platformSessions).set({ mfaPending: false }).where(eq(platformSessions.id, s.session.id));
    await platformLog({ admin: { id: s.admin.id }, ip: s.session.ip }, enrolling ? "mfa_enrolled" : "login");
    redirect("/admin");
  });
}

export async function adminLogoutAction() {
  const s = await readPlatformSession();
  if (s) await platformLog({ admin: { id: s.admin.id }, ip: s.session.ip }, "logout");
  await destroyPlatformSession();
  redirect("/admin/login");
}
