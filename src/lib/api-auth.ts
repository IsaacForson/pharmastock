import { unstable_rethrow } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { adminDb, withTenant, type Tx } from "@/db";
import { apiKeys, auditLog, branches, tenants, users } from "@/db/schema";
import { UserError } from "./action";
import type { Ctx } from "./auth";
import { randomToken, sha256 } from "./crypto";
import { accessLevel, hasFeature } from "./plans";

export const API_RESOURCES = ["products", "stock", "sales", "customers", "suppliers", "purchase_orders", "alerts", "recalls"] as const;
export type ApiResource = (typeof API_RESOURCES)[number];
export type ApiScope = `${ApiResource}:${"read" | "write"}`;
/** Resources that accept writes through the public API. */
export const WRITABLE: readonly ApiResource[] = ["products", "sales", "customers"];

export function newApiKey() {
  const key = `ps_live_${randomToken(24)}`;
  return { key, prefix: key.slice(0, 12), keyHash: sha256(key) };
}

export type ApiKeyCtx = { keyId: string; tenantId: string; createdBy: string | null; tenant: { country: string; timezone: string; currency: string } };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// shortcut: in-memory fixed window per process; move to Postgres/Redis when running more than one instance.
const WINDOW_MS = 60_000;
export const RATE_LIMIT = 120;
const hits = new Map<string, { start: number; count: number }>();
export function rateLimited(keyId: string, now = Date.now()) {
  const w = hits.get(keyId);
  if (!w || now - w.start >= WINDOW_MS) {
    hits.set(keyId, { start: now, count: 1 });
    return false;
  }
  return ++w.count > RATE_LIMIT;
}

/** Validates the Bearer key for a scope. Throws ApiError (401/403/429). */
export async function authenticate(req: Request, scope: ApiScope): Promise<ApiKeyCtx> {
  const m = /^Bearer\s+(ps_live_\S+)$/.exec(req.headers.get("authorization") ?? "");
  if (!m) throw new ApiError(401, "Missing or malformed Authorization: Bearer <api key>");
  const [row] = await adminDb()
    .select({ key: apiKeys, plan: tenants.plan, planStatus: tenants.planStatus, country: tenants.country, timezone: tenants.timezone, currency: tenants.currency })
    .from(apiKeys).innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
    .where(and(eq(apiKeys.keyHash, sha256(m[1])), isNull(apiKeys.revokedAt))).limit(1);
  if (!row) throw new ApiError(401, "Invalid or revoked API key");
  if (!hasFeature(row, "api")) throw new ApiError(403, "The API is available on the Chain plan");
  if (!row.key.scopes.includes(scope)) throw new ApiError(403, `This key lacks the ${scope} scope`);
  if (rateLimited(row.key.id)) throw new ApiError(429, `Rate limit is ${RATE_LIMIT} requests per minute`);
  if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000) {
    await adminDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
  }
  return { keyId: row.key.id, tenantId: row.key.tenantId, createdBy: row.key.createdBy, tenant: { country: row.country, timezone: row.timezone, currency: row.currency } };
}

/** Wraps a handler: auth + scope + rate limit, then runs inside withTenant (RLS) and maps errors to JSON. */
export async function apiHandler(req: Request, scope: ApiScope, fn: (t: Tx, k: ApiKeyCtx) => Promise<unknown>): Promise<Response> {
  try {
    const k = await authenticate(req, scope);
    const body = await withTenant(k.tenantId, (t) => fn(t, k));
    return body instanceof Response ? body : Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    unstable_rethrow(e); // let Next's own control-flow errors (prerender bailout, redirects) through
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status, headers: e.status === 429 ? { "Retry-After": "60" } : undefined });
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 422 });
    if (e instanceof z.ZodError) return Response.json({ error: "Invalid request", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
    console.error(e);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function apiAudit(t: Tx, k: ApiKeyCtx, action: string, entity: string, entityId: string | null, customerId?: string | null, details: Record<string, unknown> = {}) {
  await t.insert(auditLog).values({ tenantId: k.tenantId, userId: k.createdBy, action, entity, entityId, customerId: customerId ?? null, details: { ...details, apiKeyId: k.keyId, via: "api" } });
}

/**
 * Builds the actor for writes that need a signed-in user (createSale): the staff member who created the API key acts,
 * at the given branch (default: the main branch). Their role limits (discounts, pharmacist supervision, credit) apply.
 */
export async function apiActor(t: Tx, k: ApiKeyCtx, branchId?: string | null): Promise<Ctx> {
  if (!k.createdBy) throw new ApiError(409, "This API key has no owner. Create a new key in Settings → API keys to record sales.");
  const [user] = await t.select().from(users).where(and(eq(users.id, k.createdBy), eq(users.tenantId, k.tenantId)));
  if (!user || !user.active) throw new ApiError(409, "The staff member who created this API key is no longer active. Create a new key to record sales.");
  const [tenant] = await t.select().from(tenants).where(eq(tenants.id, k.tenantId));
  if (accessLevel(tenant) === "read_only") throw new ApiError(403, "This account is read-only until the subscription is renewed");
  const all = await t.select({ id: branches.id, name: branches.name, isMain: branches.isMain }).from(branches).where(and(eq(branches.tenantId, k.tenantId), eq(branches.active, true)));
  const allowed = user.branchIds?.length ? all.filter((b) => user.branchIds!.includes(b.id)) : all;
  const branch = branchId ? allowed.find((b) => b.id === branchId) : allowed.find((b) => b.isMain) ?? allowed[0];
  if (!branch) throw new ApiError(422, branchId ? "Unknown branchId (or the key owner can't sell at that branch)" : "No active branch");
  return { user, tenant, sessionId: `api:${k.keyId}`, branchId: branch.id, branches: allowed.map(({ id, name }) => ({ id, name })), access: "full", ip: null, impersonatedBy: null };
}

/** ?limit (1–100, default 50) and opaque ?cursor (id of the last row seen; results are ordered by id). */
export function pageParams(req: Request) {
  const u = new URL(req.url);
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 50, 1), 100);
  const cursor = u.searchParams.get("cursor");
  if (cursor && !/^[0-9a-f-]{36}$/i.test(cursor)) throw new ApiError(400, "Invalid cursor");
  return { limit, cursor, params: u.searchParams };
}

export function page<T extends { id: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  return { data, nextCursor: rows.length > limit ? data[data.length - 1].id : null };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Body must be JSON");
  }
}

/** Writes are refused on read-only (unpaid) accounts; reads and exports always work. */
export async function assertWritable(t: Tx, k: ApiKeyCtx) {
  const [tenant] = await t.select().from(tenants).where(eq(tenants.id, k.tenantId));
  if (!tenant || accessLevel(tenant) === "read_only") throw new ApiError(403, "This account is read-only until the subscription is renewed");
}
