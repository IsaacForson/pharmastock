/**
 * One-time Supabase setup. Run with DATABASE_URL pointing at your Supabase project's DIRECT connection (user "postgres").
 *   APP_DB_PASSWORD=<strong password> npx tsx scripts/supabase-setup.mts
 * 1. Creates the runtime role `pharmastock_app` (not table owner → row-level security always applies to it).
 * 2. Creates the private storage bucket for pharmacy files (if SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set).
 * Then run `pnpm migrate` (also against the direct connection).
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
const pw = process.env.APP_DB_PASSWORD;
if (!url || !pw || pw.length < 16) {
  console.error("Set DATABASE_URL (Supabase direct connection) and APP_DB_PASSWORD (16+ characters).");
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
const [{ exists }] = await sql<{ exists: boolean }[]>`select exists(select 1 from pg_roles where rolname = 'pharmastock_app') as exists`;
if (exists) await sql.unsafe(`alter role pharmastock_app with login password '${pw.replace(/'/g, "''")}'`);
else await sql.unsafe(`create role pharmastock_app with login password '${pw.replace(/'/g, "''")}' nobypassrls`);
const [{ db }] = await sql<{ db: string }[]>`select current_database() as db`;
await sql.unsafe(`grant connect on database "${db}" to pharmastock_app`);
console.log(`${exists ? "Updated" : "Created"} role pharmastock_app on database ${db}.`);
await sql.end();

const sbUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "pharmacy-files";
if (sbUrl && key) {
  const headers = { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
  const got = await fetch(`${sbUrl}/storage/v1/bucket/${bucket}`, { headers });
  if (got.ok) console.log(`Storage bucket "${bucket}" already exists.`);
  else {
    const res = await fetch(`${sbUrl}/storage/v1/bucket`, { method: "POST", headers, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 50 * 1024 * 1024 }) });
    if (!res.ok) { console.error(`Couldn't create bucket: ${res.status} ${await res.text()}`); process.exit(1); }
    console.log(`Created private storage bucket "${bucket}".`);
  }
} else {
  console.log("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — skipped the storage bucket (files will use local disk).");
}
console.log("Next: pnpm migrate, then create the first Control admin: npx tsx scripts/create-admin.mts --email you@x --name \"You\"");
process.exit(0);
