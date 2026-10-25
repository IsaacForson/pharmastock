import { eq, getTableColumns, getTableName, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, withTenant } from "@/db";
import * as schema from "@/db/schema";
import { purgeTenant } from "@/lib/provision";

// A user of tenant A must never read or write tenant B's rows, for every tenant-scoped table.
const tenantTables = (Object.values(schema) as unknown[]).filter(
  (v): v is PgTable => v instanceof PgTable && "tenantId" in getTableColumns(v),
);

// Owner-only tables (no app-role grant) are covered by the "permission denied" test instead.
const OWNER_ONLY = new Set(["sessions", "platform_log"]);

/** Drizzle wraps driver errors; match against the underlying Postgres message. */
async function rejectsWith(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(() => null, (err: { message?: string; cause?: { message?: string } }) => err);
  expect(e, "expected the query to fail").not.toBeNull();
  expect(`${e?.cause?.message ?? ""} ${e?.message ?? ""}`).toMatch(re);
}

let a: string, b: string;

beforeAll(async () => {
  const db = adminDb();
  [{ id: a }] = await db.insert(schema.tenants).values({ name: "Iso A", slug: `iso-a-${Date.now()}` }).returning();
  [{ id: b }] = await db.insert(schema.tenants).values({ name: "Iso B", slug: `iso-b-${Date.now()}` }).returning();
  for (const t of [a, b]) {
    const [br] = await db.insert(schema.branches).values({ tenantId: t, name: "Main", isMain: true }).returning();
    const [u] = await db.insert(schema.users).values({ tenantId: t, name: "Iso", role: "owner" }).returning();
    await db.insert(schema.customers).values({ tenantId: t, customerNo: "C-1", name: "Iso " + t.slice(0, 6), allergies: "SECRET-" + t });
    const [p] = await db.insert(schema.products).values({ tenantId: t, name: "Pethidine 50 mg", schedule: "controlled" }).returning();
    const [unit] = await db.insert(schema.productUnits).values({ tenantId: t, productId: p.id, name: "ampoule", isDefault: true }).returning();
    await db.insert(schema.barcodes).values({ tenantId: t, code: "ISO-1", productId: p.id, unitId: unit.id });
    const [batch] = await db.insert(schema.stockBatches).values({ tenantId: t, productId: p.id, branchId: br.id, batchNo: "B1", qtyOnHand: 5 }).returning();
    await db.insert(schema.stockMovements).values({ tenantId: t, productId: p.id, batchId: batch.id, branchId: br.id, qty: 5, type: "receive" });
    await db.insert(schema.controlledRegister).values({ tenantId: t, branchId: br.id, productId: p.id, batchId: batch.id, entryNo: 1, kind: "received", qtyIn: 5, balance: 5, enteredBy: u.id });
    await db.insert(schema.auditLog).values({ tenantId: t, action: "test", entity: "customer" });
  }
});

afterAll(async () => {
  // purgeTenant lifts the register guard for that tenant only; a plain delete would be refused.
  await purgeTenant(a);
  await purgeTenant(b);
});

describe("row-level security", () => {
  it("covers every table with a tenant_id column", async () => {
    const rows = await adminDb().execute<{ relname: string; relrowsecurity: boolean }>(sql`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join information_schema.columns col on col.table_schema = n.nspname and col.table_name = c.relname and col.column_name = 'tenant_id'
      where c.relkind = 'r' and n.nspname in ('public','audit')`);
    expect(rows.length).toBeGreaterThanOrEqual(tenantTables.length);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it.each(tenantTables.filter((t) => !OWNER_ONLY.has(getTableName(t))).map((t) => [getTableName(t), t] as const))("%s: tenant A sees no rows of tenant B", async (_name, table) => {
    const leaked = await withTenant(a, (t) => t.select({ n: sql<number>`count(*)::int` }).from(table).where(eq((table as never as { tenantId: never }).tenantId, b)));
    expect(leaked[0].n).toBe(0);
  });

  it("sees its own rows", async () => {
    const own = await withTenant(a, (t) => t.select().from(schema.customers));
    expect(own).toHaveLength(1);
    expect(own[0].allergies).toBe("SECRET-" + a);
  });

  it("cannot insert rows for another tenant", async () => {
    await rejectsWith(withTenant(a, (t) => t.insert(schema.customers).values({ tenantId: b, customerNo: "X", name: "x" })), /row-level security/);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const updated = await withTenant(a, (t) => t.update(schema.customers).set({ name: "hacked" }).where(eq(schema.customers.tenantId, b)).returning());
    expect(updated).toHaveLength(0);
    const deleted = await withTenant(a, (t) => t.delete(schema.products).where(eq(schema.products.tenantId, b)).returning());
    expect(deleted).toHaveLength(0);
  });

  it("sees nothing without a tenant set", async () => {
    const rows = await withTenant("", (t) => t.select().from(schema.customers)).catch(() => []);
    expect(rows).toHaveLength(0);
  });

  it("only sees its own tenant row", async () => {
    const rows = await withTenant(a, (t) => t.select().from(schema.tenants));
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it("cannot read sessions or OTP codes at all", async () => {
    await rejectsWith(withTenant(a, (t) => t.select().from(schema.sessions)), /permission denied/);
    await rejectsWith(withTenant(a, (t) => t.select().from(schema.otpCodes)), /permission denied/);
  });

  it("cannot touch PharmaStock team tables (admins, admin sessions, admin audit)", async () => {
    await rejectsWith(withTenant(a, (t) => t.select().from(schema.platformAdmins)), /permission denied/);
    await rejectsWith(withTenant(a, (t) => t.select().from(schema.platformSessions)), /permission denied/);
    await rejectsWith(withTenant(a, (t) => t.select().from(schema.platformAudit)), /permission denied/);
  });

  it("gives Supabase's Data API roles (anon, authenticated) no access to any table", async () => {
    const rows = await adminDb().execute<{ n: number }>(sql`
      select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_schema in ('public', 'audit')`);
    expect(rows[0].n).toBe(0);
  });

  it("keeps the controlled-drug register append-only, even for the owner connection", async () => {
    await rejectsWith(withTenant(a, (t) => t.update(schema.controlledRegister).set({ balance: 0 })), /permission denied|append-only/);
    await rejectsWith(withTenant(a, (t) => t.delete(schema.controlledRegister)), /permission denied|append-only/);
    await rejectsWith(adminDb().update(schema.controlledRegister).set({ balance: 0 }).where(eq(schema.controlledRegister.tenantId, a)), /append-only/);
    await rejectsWith(adminDb().delete(schema.controlledRegister).where(eq(schema.controlledRegister.tenantId, a)), /append-only/);
    const rows = await withTenant(a, (t) => t.select().from(schema.controlledRegister));
    expect(rows).toHaveLength(1);
  });

  it("keeps the audit log append-only", async () => {
    await rejectsWith(withTenant(a, (t) => t.update(schema.auditLog).set({ action: "x" })), /permission denied|append-only/);
    await rejectsWith(adminDb().delete(schema.auditLog).where(eq(schema.auditLog.tenantId, a)), /append-only/);
  });
});
