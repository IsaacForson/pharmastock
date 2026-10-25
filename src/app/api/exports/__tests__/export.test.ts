import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "@/db";
import * as schema from "@/db/schema";
import { buildTenantExport, CSV_TABLES, tenantTables, toCsv } from "@/lib/export";
import { purgeTenant } from "@/lib/provision";
import { crc32, createZip } from "@/lib/zip";

const dir = mkdtempSync(path.join(tmpdir(), "ps-export-"));
process.env.STORAGE_DIR = dir;

describe("zip writer", () => {
  it("computes standard CRC32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("produces an archive that unzip validates and extracts byte-for-byte", () => {
    const bin = Buffer.from([0, 1, 2, 255, 254, 10, 13]);
    const zip = createZip([{ name: "a.txt", data: "hello wörld\n" }, { name: "dir/b.bin", data: bin }, { name: "empty.json", data: "" }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    const file = path.join(dir, "t.zip");
    writeFileSync(file, zip);
    expect(execFileSync("unzip", ["-t", file]).toString()).toMatch(/No errors detected/);
    expect(execFileSync("unzip", ["-p", file, "a.txt"]).toString()).toBe("hello wörld\n");
    expect(Buffer.compare(execFileSync("unzip", ["-p", file, "dir/b.bin"]), bin)).toBe(0);
  });

  it("escapes CSV cells", () => {
    expect(toCsv([{ a: 'x,"y"', b: null, c: new Date("2026-01-01T00:00:00Z") }], ["a", "b", "c"])).toBe('a,b,c\r\n"x,""y""",,2026-01-01T00:00:00.000Z\r\n');
  });
});

describe("buildTenantExport", () => {
  let tenantId: string, jobId: string, userId: string;
  beforeAll(async () => {
    const db = adminDb();
    [{ id: tenantId }] = await db.insert(schema.tenants).values({ name: "Export Pharmacy", slug: `export-${Date.now()}` }).returning({ id: schema.tenants.id });
    [{ id: userId }] = await db.insert(schema.users).values({ tenantId, name: "Owner", role: "owner", passwordHash: "scrypt.SECRETHASH", pinHash: "scrypt.PINHASH" }).returning({ id: schema.users.id });
    await db.insert(schema.customers).values({ tenantId, customerNo: "C-000001", name: "Ama Mensah", notes: "private, note" });
    [{ id: jobId }] = await db.insert(schema.exportJobs).values({ tenantId, requestedBy: userId }).returning({ id: schema.exportJobs.id });
  });
  afterAll(async () => {
    await purgeTenant(tenantId);
    rmSync(dir, { recursive: true, force: true });
  });

  it("has a CSV for every pharmacy table it promises", () => {
    const names = new Set(tenantTables().map((t) => t.name));
    for (const t of CSV_TABLES) expect(names.has(t), t).toBe(true);
  });

  it("writes a valid zip with decrypted data and no secrets, and marks the job done", async () => {
    await buildTenantExport(tenantId, jobId);
    const [job] = await adminDb().select().from(schema.exportJobs).where(eq(schema.exportJobs.id, jobId));
    expect(job.status).toBe("done");
    const file = path.join(dir, job.storageKey!);
    expect(execFileSync("unzip", ["-t", file]).toString()).toMatch(/No errors detected/);
    const customers = JSON.parse(execFileSync("unzip", ["-p", file, "json/customers.json"]).toString());
    expect(customers[0].notes).toBe("private, note");
    expect(execFileSync("unzip", ["-p", file, "csv/customers.csv"]).toString()).toMatch(/"private, note"/);
    expect(execFileSync("unzip", ["-l", file]).toString()).toMatch(/csv\/controlled_register\.csv/);
    const usersJson = execFileSync("unzip", ["-p", file, "json/users.json"]).toString();
    expect(usersJson).toContain("Owner");
    expect(usersJson).not.toContain("SECRETHASH");
    expect(usersJson).not.toContain("PINHASH");
    expect(readFileSync(file).length).toBeGreaterThan(100);
    const [log] = await adminDb().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, jobId));
    expect(log.action).toBe("export");
  });
});
