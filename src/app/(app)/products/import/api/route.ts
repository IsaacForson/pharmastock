import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { products, suppliers } from "@/db/schema";
import { UserError } from "@/lib/action";
import { AuthError, requireWrite, tx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { buildIndex, commitImport, detectMapping, FIELDS, loadCatalog, matchRecord, parseSheet, toRecords, type ImportField } from "@/lib/import";

/**
 * Import steps as a route handler (not server actions): spreadsheets of a few thousand rows exceed the server-action body limit.
 * multipart POST = parse the file; JSON POST {step: "preview" | "commit"}.
 */
const MAX_BYTES = 8 * 1024 * 1024, MAX_ROWS = 10_000;

const mapping = z.record(z.enum(Object.keys(FIELDS) as [ImportField, ...ImportField[]]), z.number().int().min(0).max(200));
const previewBody = z.object({ step: z.literal("preview"), rows: z.array(z.array(z.string().max(500)).max(200)).max(MAX_ROWS), mapping, firstLine: z.number().int().min(1) });
const rec = z.object({
  line: z.number().int(), name: z.string().max(200), genericName: z.string().max(200).nullable(), strength: z.string().max(60).nullable(), form: z.string().max(60).nullable(),
  manufacturer: z.string().max(200).nullable(), category: z.string().max(80).nullable(), barcode: z.string().max(64).nullable(), supplierCode: z.string().max(64).nullable(),
  packName: z.string().max(40).nullable(), packSize: z.number().int().min(1).max(100_000).nullable(), costMinor: z.number().int().min(0).nullable(),
  priceMinor: z.number().int().min(0).nullable(), batchNo: z.string().max(60).nullable(), expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  qty: z.number().min(0).max(10_000_000).nullable(), errors: z.array(z.string()), productId: z.string().uuid().nullable(),
});
const commitBody = z.object({
  step: z.literal("commit"), rows: z.array(rec).max(1000),
  supplierId: z.string().uuid().nullable(), openingStock: z.boolean(), updatePrices: z.boolean(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireWrite("products.write");
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File) || !file.size) throw new UserError("Choose a CSV or Excel file");
      if (file.size > MAX_BYTES) throw new UserError("That file is over 8 MB. Split it into smaller files.");
      const grid = await parseSheet(Buffer.from(await file.arrayBuffer()), file.name).catch((e) => { throw new UserError(e instanceof Error && /xls|support/i.test(e.message) ? e.message : "Couldn't read that file. Save it as CSV or .xlsx and try again."); });
      if (grid.length < 2) throw new UserError("The file needs a header row and at least one product row");
      if (grid.length > MAX_ROWS + 1) throw new UserError(`Up to ${MAX_ROWS} rows per file, please`);
      return Response.json({ header: grid[0], rows: grid.slice(1), mapping: detectMapping(grid[0]) });
    }
    const body = (await req.json()) as { step?: string };
    if (body.step === "preview") {
      const o = previewBody.parse(body);
      if (o.mapping.name === undefined) throw new UserError("Tell us which column has the product name");
      const records = toRecords(o.rows, o.mapping, o.firstLine);
      return Response.json(await tx(ctx, async (t) => {
        const idx = buildIndex(await loadCatalog(t));
        const matches = records.map((r) => matchRecord(idx, r));
        const ids = [...new Set(matches.flatMap((m) => [m.productId, ...m.candidates.map((c) => c.id)]).filter((x): x is string => !!x))];
        const names = ids.length ? await t.select({ id: products.id, name: products.name, strength: products.strength, form: products.form }).from(products).where(inArray(products.id, ids)) : [];
        return { records, matches, products: Object.fromEntries(names.map((p) => [p.id, [p.name, p.strength, p.form].filter(Boolean).join(" ")])) };
      }));
    }
    if (body.step === "commit") {
      const o = commitBody.parse(body);
      const result = await tx(ctx, async (t) => {
        if (o.supplierId && !(await t.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, o.supplierId))).length) throw new UserError("Supplier not found");
        if (o.openingStock && !can(ctx.user.role, "stock.receive")) throw new UserError("You can't add opening stock. Ask a manager.");
        if (o.updatePrices && !can(ctx.user.role, "prices.write")) throw new UserError("You can't change selling prices. Untick that option or ask a manager.");
        return commitImport(t, ctx, o.rows, { supplierId: o.supplierId, openingStock: o.openingStock, updatePrices: o.updatePrices, branchId: ctx.branchId });
      });
      return Response.json(result);
    }
    return Response.json({ error: "Unknown step" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError || e instanceof UserError) return Response.json({ error: e.message }, { status: e instanceof AuthError ? 403 : 400 });
    if (e instanceof z.ZodError) return Response.json({ error: "Some rows weren't in the expected shape. Re-upload the file and try again." }, { status: 400 });
    console.error(e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
