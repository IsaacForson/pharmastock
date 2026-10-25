import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { headers } from "next/headers";
import { adminDb } from "@/db";
import { purchaseOrders, supplierLinks, suppliers, tenants } from "@/db/schema";
import { sha256 } from "@/lib/crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // randomToken(): 32 random bytes, base64url
const MAX_MISSES = 20, WINDOW_MS = 10 * 60_000;
// shortcut: per-process memory, so limits reset on restart and aren't shared across instances; move to Redis/DB if scaled out.
const misses = new Map<string, { n: number; since: number }>();

async function clientIp() {
  return (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export type SupplierSession = NonNullable<Awaited<ReturnType<typeof resolveSupplierLink>>>;

/**
 * Token -> (tenant, supplier, PO). Tokens are 256-bit random and only their hash is stored, so guessing is hopeless; the
 * per-IP miss counter still stops anyone hammering the endpoint. Every later query must filter by this tenant and PO.
 */
export async function resolveSupplierLink(token: string) {
  const ip = await clientIp();
  const now = Date.now();
  const m = misses.get(ip);
  if (m && now - m.since < WINDOW_MS && m.n >= MAX_MISSES) return "blocked" as const;
  const miss = () => {
    const cur = m && now - m.since < WINDOW_MS ? m : { n: 0, since: now };
    misses.set(ip, { n: cur.n + 1, since: cur.since });
    if (misses.size > 10_000) misses.clear();
    return null;
  };
  if (!TOKEN_RE.test(token)) return miss();
  const [row] = await adminDb().select({ link: supplierLinks, tenant: tenants, supplier: suppliers, po: purchaseOrders }).from(supplierLinks)
    .innerJoin(tenants, eq(tenants.id, supplierLinks.tenantId))
    .innerJoin(suppliers, and(eq(suppliers.id, supplierLinks.supplierId), eq(suppliers.tenantId, supplierLinks.tenantId)))
    .innerJoin(purchaseOrders, and(eq(purchaseOrders.id, supplierLinks.poId), eq(purchaseOrders.tenantId, supplierLinks.tenantId), eq(purchaseOrders.supplierId, supplierLinks.supplierId)))
    .where(and(eq(supplierLinks.tokenHash, sha256(token)), gt(supplierLinks.expiresAt, new Date()))).limit(1);
  if (!row) return miss();
  return row;
}
