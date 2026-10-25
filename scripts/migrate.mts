import "dotenv/config";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.argv[2] === "--test" ? process.env.DATABASE_URL!.replace(/\/pharmastock$/, "/pharmastock_test") : process.env.DATABASE_URL!;
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "drizzle" });
await client.unsafe(readFileSync(new URL("../src/db/rls.sql", import.meta.url), "utf8"));
console.log("migrated", url.replace(/:[^:@]+@/, ":***@"));
await client.end();
