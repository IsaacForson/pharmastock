import { getTableName, sql, type AnyColumn } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const g = globalThis as unknown as { __cfAdmin?: Db; __cfApp?: Db };

function connect(url: string | undefined, name: string): Db {
  if (!url) throw new Error(`${name} is not set`);
  return drizzle(postgres(url, { max: 1, idle_timeout: 5, prepare: false }), { schema });
}

/** Owner connection: bypasses RLS. Only for auth, signup, workers, webhooks and migrations. */
export const adminDb = (): Db => (g.__cfAdmin ??= connect(process.env.DATABASE_URL, "DATABASE_URL"));

const appDb = (): Db => (g.__cfApp ??= connect(process.env.APP_DATABASE_URL, "APP_DATABASE_URL"));

/** Runs fn in a transaction where Postgres RLS restricts every row to tenantId. */
export function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

export { schema };

/**
 * A column written with its table name, for references to the OUTER query inside a correlated subquery. Drizzle leaves
 * columns unqualified in single-table selects, and Postgres then binds a bare "id" to the subquery's own table.
 */
export const outer = (c: AnyColumn) => sql.raw(`"${getTableName(c.table)}"."${c.name}"`);
