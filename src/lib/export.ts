import { eq, getTableColumns, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { withTenant } from "@/db";
import * as schema from "@/db/schema";
import { auditLog, documents, exportJobs } from "@/db/schema";
import { getFile, putFile } from "./storage";
import { createZip } from "./zip";

// Never exported: auth secrets the app role can't read anyway, provider credentials, and internal plumbing.
// platform_log is the PharmaStock team's internal audit trail (not pharmacy data, and not readable by the pharmacy role).
const SKIP_TABLES = new Set(["sessions", "otp_codes", "integrations", "supplier_links", "jobs", "platform_log"]);
const SECRET_KEYS = new Set(["passwordHash", "pinHash", "totpSecret", "keyHash", "tokenHash", "secret", "config"]);
/** Spreadsheet copies of the tables pharmacies open most (JSON has every table). */
export const CSV_TABLES = new Set([
  "products", "product_units", "stock_batches", "stock_movements", "sales", "sale_lines", "payments", "customers",
  "prescriptions", "prescription_items", "purchase_orders", "goods_receipts", "suppliers", "controlled_register", "expenses",
]);

/** Every table that holds tenant data (has tenant_id), plus the tenant row itself. */
export function tenantTables() {
  return (Object.values(schema) as unknown[])
    .filter((v): v is PgTable => is(v, PgTable))
    .map((table) => ({ table, cfg: getTableConfig(table) }))
    .filter(({ cfg }) => !SKIP_TABLES.has(cfg.name) && (cfg.name === "tenants" || cfg.columns.some((c) => c.name === "tenant_id")))
    .map(({ table, cfg }) => ({ table, file: cfg.schema ? `${cfg.schema}_${cfg.name}` : cfg.name, name: cfg.name }));
}

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[], cols: string[]) {
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

const README = (tenantName: string, at: Date) => `PharmaStock full data export for ${tenantName}
Created ${at.toISOString()}

This archive is yours. It contains every record PharmaStock holds for your pharmacy:
- json/<table>.json  every table, all columns (encrypted fields such as allergies and diagnoses are
                     decrypted here — store this file securely)
- csv/<table>.csv    spreadsheet-friendly copies of the main tables: products, pack sizes, batches,
                     stock movements, sales and sale lines, payments, customers, prescriptions,
                     purchase orders, goods receipts, suppliers, the controlled-drug register, expenses
- documents/         uploaded files (prescription scans, delivery notes, logo), named <document id>-<original name>
Amounts ending in "_minor" are in minor currency units (divide by 100). Quantities in stock tables are in
base units (tablet, bottle); product_units.factor converts packs. Times are UTC (ISO 8601).
Login passwords, staff PINs, 2FA secrets, API key hashes, supplier links and provider credentials are excluded.
`;

/** Builds the full export zip for an export_jobs row. Called by the worker for job "export.run". */
export async function buildTenantExport(tenantId: string, exportJobId: string): Promise<void> {
  await withTenant(tenantId, (t) => t.update(exportJobs).set({ status: "running" }).where(eq(exportJobs.id, exportJobId)));
  try {
    const { files, requestedBy, tenantName } = await withTenant(tenantId, async (t) => {
      const [job] = await t.select().from(exportJobs).where(eq(exportJobs.id, exportJobId));
      if (!job) throw new Error("Export job not found");
      const files: { name: string; data: Uint8Array | string }[] = [];
      let tenantName = "";
      for (const { table, file, name } of tenantTables()) {
        const raw = (await t.select().from(table)) as Record<string, unknown>[];
        const rows = raw.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_KEYS.has(k))));
        if (name === "tenants") tenantName = String(rows[0]?.name ?? "");
        files.push({ name: `json/${file}.json`, data: JSON.stringify(rows, null, 1) });
        if (CSV_TABLES.has(name)) {
          const cols = Object.keys(getTableColumns(table)).filter((k) => !SECRET_KEYS.has(k));
          files.push({ name: `csv/${file}.csv`, data: toCsv(rows, cols) });
        }
      }
      // shortcut: whole archive (including uploaded files) is built in memory; stream it if pharmacies exceed a few hundred MB.
      for (const d of await t.select().from(documents)) {
        const data = await getFile(tenantId, d.storageKey).catch(() => null);
        if (data) files.push({ name: `documents/${d.id}-${d.name.replace(/[/\\]/g, "_")}`, data });
      }
      return { files, requestedBy: job.requestedBy, tenantName };
    });
    const at = new Date();
    files.unshift({ name: "README.txt", data: README(tenantName, at) });
    const key = await putFile(tenantId, `export-${at.toISOString().slice(0, 10)}.zip`, createZip(files, at), "application/zip");
    await withTenant(tenantId, async (t) => {
      await t.update(exportJobs).set({ status: "done", storageKey: key, completedAt: new Date(), error: null }).where(eq(exportJobs.id, exportJobId));
      await t.insert(auditLog).values({ tenantId, userId: requestedBy, action: "export", entity: "export_job", entityId: exportJobId, details: { files: files.length } });
    });
  } catch (e) {
    await withTenant(tenantId, (t) => t.update(exportJobs).set({ status: "failed", error: (e as Error).message.slice(0, 500) }).where(eq(exportJobs.id, exportJobId)));
    throw e;
  }
}
