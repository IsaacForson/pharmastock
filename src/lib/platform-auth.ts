import "server-only";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/db";
import { platformAdmins, platformAudit, platformSessions, type PlatformAdmin, type PlatformRole } from "@/db/schema";
import { UserError } from "./action";
import { newTotpSecret, randomToken, sha256 } from "./crypto";

/**
 * PharmaStock team ("platform") auth. Entirely separate from pharmacy auth: own table, own cookie, 2FA mandatory.
 * All platform queries use adminDb() (cross-tenant by design) and every mutation is written to audit.platform_log.
 */
const COOKIE = "ps_admin";
const SESSION_HOURS = 8;
const IDLE_MINUTES = 30;

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = { super_admin: "Super admin", support: "Support", finance: "Finance" };

const CAPS = {
  "revenue.view": ["super_admin", "finance"],
  "pharmacies.billing": ["super_admin", "finance"],
  "pharmacies.suspend": ["super_admin"],
  "pharmacies.impersonate": ["super_admin", "support"],
  "pharmacies.delete": ["super_admin"],
  "pharmacies.notes": ["super_admin", "support", "finance"],
  "system.jobs": ["super_admin", "support"],
  "recalls.manage": ["super_admin", "support"],
  "team.manage": ["super_admin"],
} as const satisfies Record<string, readonly PlatformRole[]>;
export type PlatformCap = keyof typeof CAPS;
export const platformCan = (role: PlatformRole, cap: PlatformCap) => (CAPS[cap] as readonly PlatformRole[]).includes(role);

export type AdminCtx = { admin: PlatformAdmin; sessionId: string; ip: string | null };

async function clientInfo() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") };
}

/** New session always starts MFA-pending: the TOTP step (or enrolment) completes it. */
export async function createPlatformSession(admin: PlatformAdmin) {
  const token = randomToken();
  const { ip, userAgent } = await clientInfo();
  await adminDb().insert(platformSessions).values({
    id: sha256(token), adminId: admin.id, mfaPending: true, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000), ip, userAgent,
  });
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: SESSION_HOURS * 3600 });
}

export async function destroyPlatformSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await adminDb().delete(platformSessions).where(eq(platformSessions.id, sha256(token)));
  jar.delete(COOKIE);
}

export const readPlatformSession = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const [row] = await adminDb().select({ session: platformSessions, admin: platformAdmins })
    .from(platformSessions).innerJoin(platformAdmins, eq(platformAdmins.id, platformSessions.adminId)).where(eq(platformSessions.id, id)).limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.session.expiresAt.getTime() < now || row.session.lastSeenAt.getTime() < now - IDLE_MINUTES * 60_000 || !row.admin.active) {
    await adminDb().delete(platformSessions).where(eq(platformSessions.id, id));
    return null;
  }
  if (now - row.session.lastSeenAt.getTime() > 60_000) await adminDb().update(platformSessions).set({ lastSeenAt: new Date() }).where(eq(platformSessions.id, id));
  return row;
});

export const getAdminCtx = cache(async (): Promise<AdminCtx | null> => {
  const row = await readPlatformSession();
  if (!row || row.session.mfaPending) return null;
  return { admin: row.admin, sessionId: row.session.id, ip: row.session.ip };
});

/** Pages: redirect to the right auth step; send roles without the capability to the overview. */
export async function requireAdmin(cap?: PlatformCap): Promise<AdminCtx> {
  const ctx = await getAdminCtx();
  if (!ctx) {
    const s = await readPlatformSession();
    redirect(s?.session.mfaPending ? "/admin/2fa" : "/admin/login");
  }
  if (cap && !platformCan(ctx.admin.role, cap)) redirect("/admin?denied=1");
  return ctx;
}

export class PlatformAuthError extends UserError {}

/** Server actions: same checks, throwing instead of redirecting. */
export async function requireAdminAction(cap?: PlatformCap): Promise<AdminCtx> {
  const ctx = await getAdminCtx();
  if (!ctx) throw new PlatformAuthError("Your admin session has expired. Sign in again.");
  if (cap && !platformCan(ctx.admin.role, cap)) throw new PlatformAuthError("Your admin role can't do that.");
  return ctx;
}

export async function platformLog(ctx: AdminCtx | { admin: { id: string }; ip: string | null }, action: string, o: { tenantId?: string | null; entity?: string; entityId?: string | null; details?: unknown } = {}) {
  await adminDb().insert(platformAudit).values({
    adminId: ctx.admin.id, action, tenantId: o.tenantId ?? null, entity: o.entity ?? null, entityId: o.entityId ?? null, details: o.details ?? null, ip: ctx.ip,
  });
}

/** Server-only (never a server action): gives an un-enrolled admin a secret to scan, kept until enrolment is confirmed. */
export async function ensureEnrolmentSecret(admin: Pick<PlatformAdmin, "id" | "totpSecret" | "totpEnabled">) {
  if (admin.totpSecret) return admin.totpSecret;
  if (admin.totpEnabled) throw new Error("Enrolled admin without a secret");
  const secret = newTotpSecret();
  await adminDb().update(platformAdmins).set({ totpSecret: secret }).where(eq(platformAdmins.id, admin.id));
  return secret;
}
