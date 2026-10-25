/**
 * Creates (or resets) a PharmaStock team admin. Prints a one-time password; 2FA is enrolled at first sign-in.
 * Usage: npx tsx scripts/create-admin.mts --email you@pharmastock.app --name "Your Name" [--role super_admin|support|finance]
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { adminDb } from "../src/db/index";
import { platformAdmins, platformAudit } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const email = arg("email")?.toLowerCase();
const name = arg("name") ?? email;
const role = (arg("role") ?? "super_admin") as "super_admin" | "support" | "finance";
if (!email || !["super_admin", "support", "finance"].includes(role)) {
  console.error('Usage: npx tsx scripts/create-admin.mts --email you@x.com --name "Name" [--role super_admin|support|finance]');
  process.exit(1);
}
const password = randomBytes(12).toString("base64url");
const db = adminDb();
const [existing] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, email));
const passwordHash = await hashPassword(password);
const [admin] = existing
  ? await db.update(platformAdmins).set({ passwordHash, role, active: true, totpEnabled: false, totpSecret: null }).where(eq(platformAdmins.id, existing.id)).returning()
  : await db.insert(platformAdmins).values({ email, name: name!, role, passwordHash }).returning();
await db.insert(platformAudit).values({ adminId: null, action: existing ? "admin_reset_cli" : "admin_create_cli", entity: "platform_admin", entityId: admin.id, details: { email, role } });
console.log(`${existing ? "Reset" : "Created"} ${role} ${email}\nOne-time password: ${password}\nSign in at /admin/login — you'll set up 2FA on first sign-in.`);
process.exit(0);
