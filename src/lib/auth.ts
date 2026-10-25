import "server-only";
import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminDb, withTenant, type Tx } from "@/db";
import { auditLog, branches, sessions, tenants, users, type Tenant, type User } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";
import { can, type Permission } from "./permissions";
import { accessLevel } from "./plans";

const COOKIE = "ps_session";
const BRANCH_COOKIE = "ps_branch";
const SESSION_HOURS = 12;
const IDLE_MINUTES = 60; // shared front-desk devices

export type Ctx = {
  user: User;
  tenant: Tenant;
  sessionId: string;
  branchId: string;
  branches: { id: string; name: string }[];
  access: "full" | "read_only";
  ip: string | null;
  /** Set when a PharmaStock team member is viewing this pharmacy (always read-only). */
  impersonatedBy: string | null;
};

export class AuthError extends Error {}

async function clientInfo() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") };
}

export async function createSession(user: Pick<User, "id" | "tenantId">, mfaPending: boolean) {
  const token = randomToken();
  const { ip, userAgent } = await clientInfo();
  await adminDb().insert(sessions).values({
    id: sha256(token), userId: user.id, tenantId: user.tenantId, mfaPending,
    expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000), ip, userAgent,
  });
  if (!mfaPending) await adminDb().update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await adminDb().delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(COOKIE);
}

/** Session lookup, including sessions still waiting for a 2FA code. */
export const readSession = cache(async () => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const id = sha256(token);
  const [row] = await adminDb()
    .select({ session: sessions, user: users, tenant: tenants })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId)).innerJoin(tenants, eq(tenants.id, sessions.tenantId))
    .where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  const now = Date.now();
  const suspended = !!row.tenant.suspendedAt && !row.session.impersonatedBy;
  if (row.session.expiresAt.getTime() < now || row.session.lastSeenAt.getTime() < now - IDLE_MINUTES * 60_000 || !row.user.active || suspended) {
    await adminDb().delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - row.session.lastSeenAt.getTime() > 60_000) {
    await adminDb().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }
  return row;
});

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const row = await readSession();
  if (!row || row.session.mfaPending) return null;
  const all = await adminDb().select({ id: branches.id, name: branches.name, isMain: branches.isMain })
    .from(branches).where(and(eq(branches.tenantId, row.tenant.id), eq(branches.active, true))).orderBy(branches.name);
  const allowed = row.user.branchIds?.length ? all.filter((b) => row.user.branchIds!.includes(b.id)) : all;
  const wanted = (await cookies()).get(BRANCH_COOKIE)?.value;
  const branch = allowed.find((b) => b.id === wanted) ?? allowed.find((b) => b.isMain) ?? allowed[0];
  if (!branch) return null;
  return {
    user: row.user, tenant: row.tenant, sessionId: row.session.id, branchId: branch.id,
    branches: allowed.map(({ id, name }) => ({ id, name })), ip: row.session.ip,
    access: row.session.impersonatedBy ? "read_only" : accessLevel(row.tenant), impersonatedBy: row.session.impersonatedBy,
  };
});

/** For pages: redirects to login when signed out, throws when the role lacks the permission. */
export async function requireCtx(perm?: Permission): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) {
    const s = await readSession();
    redirect(s?.session.mfaPending ? "/login/2fa" : "/login");
  }
  if (perm && !can(ctx.user.role, perm)) redirect("/forbidden");
  return ctx;
}

/** For server actions: same checks plus write access (read-only accounts can still view and export). */
export async function requireWrite(perm: Permission): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) throw new AuthError("Your session has expired. Please sign in again.");
  if (!can(ctx.user.role, perm)) throw new AuthError("You don't have permission to do that.");
  if (ctx.impersonatedBy) throw new AuthError("Support view is read-only.");
  if (ctx.access === "read_only") throw new AuthError("This account is read-only until the subscription is renewed.");
  return ctx;
}

export async function setBranch(branchId: string) {
  (await cookies()).set(BRANCH_COOKIE, branchId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
}

/** Tenant-scoped transaction for the signed-in user (RLS enforced). */
export const tx = <T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) => withTenant(ctx.tenant.id, fn);

export async function audit(
  t: Tx, ctx: Ctx, action: string, entity: string, entityId?: string | null,
  extra: { customerId?: string | null; details?: unknown } = {},
) {
  await t.insert(auditLog).values({
    tenantId: ctx.tenant.id, userId: ctx.user.id, action, entity, entityId: entityId ?? null,
    customerId: extra.customerId ?? null, ip: ctx.ip,
    details: ctx.impersonatedBy ? { ...(extra.details as object | undefined), impersonatedBy: ctx.impersonatedBy, via: "pharmastock_support" } : extra.details ?? null,
  });
}
