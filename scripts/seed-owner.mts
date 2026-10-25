/**
 * Creates a sample pharmacy with an owner you can sign in as locally, and prints the credentials.
 * Idempotent: if the owner already exists, prints how to sign in (use --reset-password for a new password).
 *
 *   npx tsx scripts/seed-owner.mts [--email owner@pharmastock.test] [--name "Ama Mensah"] [--pharmacy "Sample Pharmacy"] [--country GH]
 *                                   [--password <pw>] [--reset-password]
 *
 * For a pharmacy full of realistic data (products, batches, 120 days of sales) run scripts/seed-demo.mts instead.
 */
import "dotenv/config";
import "./lib/server-only-shim.mts";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminDb } from "../src/db/index";
import { tenants, users } from "../src/db/schema";
import { COUNTRIES } from "../src/lib/countries";
import { hashPassword } from "../src/lib/crypto";
import { TRIAL_DAYS } from "../src/lib/plans";
import { provisionTenant } from "../src/lib/provision";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const email = (arg("email") ?? "owner@pharmastock.test").toLowerCase();
const country = (arg("country") ?? "GH").toUpperCase();
if (!COUNTRIES[country]) { console.error(`Unknown country ${country}. Use one of: ${Object.keys(COUNTRIES).join(", ")}`); process.exit(1); }
const password = arg("password") ?? randomBytes(9).toString("base64url");
if (password.length < 10) { console.error("Use a password of at least 10 characters."); process.exit(1); }

const db = adminDb();
const [existing] = await db.select({ u: users, t: tenants }).from(users).innerJoin(tenants, eq(tenants.id, users.tenantId)).where(eq(users.email, email));
if (existing) {
  if (process.argv.includes("--reset-password")) {
    await db.update(users).set({ passwordHash: await hashPassword(password), active: true }).where(eq(users.id, existing.u.id));
    console.log(`Reset the password for ${email} (${existing.t.name}).\n  Password: ${password}\n  Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/login`);
  } else {
    console.log(`${email} already exists (${existing.t.name}). Re-run with --reset-password to get a new password.`);
  }
  process.exit(0);
}

const { tenant } = await provisionTenant({
  pharmacyName: arg("pharmacy") ?? "Sample Pharmacy", country, ownerName: arg("name") ?? "Ama Mensah", email, password,
});
await db.update(tenants).set({
  address: "12 Ring Road, Accra", letterhead: "Open daily 8am–9pm", licenceNo: "PC/GA/0001", superintendent: arg("name") ?? "Ama Mensah",
  superintendentRegNo: "MPSGH-0001", receiptFooter: "Thank you! Ask your pharmacist about your medicines.",
}).where(eq(tenants.id, tenant.id));

console.log(`Created ${tenant.name} (${COUNTRIES[country].name}, ${tenant.currency}) on a ${TRIAL_DAYS}-day trial.
  Email:    ${email}
  Password: ${password}
  Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/login`);
process.exit(0);
