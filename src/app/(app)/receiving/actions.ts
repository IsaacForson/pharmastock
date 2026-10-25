"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { documents } from "@/db/schema";
import { formObject, run, UserError, type ActionState } from "@/lib/action";
import { requireWrite, tx } from "@/lib/auth";
import { grnLineInput, receiveGoods } from "@/lib/purchasing";
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, putFile } from "@/lib/storage";

const json = z.string().transform((s, c) => { try { return JSON.parse(s) as unknown; } catch { c.addIssue({ code: "custom", message: "Invalid lines" }); return z.NEVER; } });
const schema = z.object({
  supplierId: z.string().uuid().optional(), poId: z.string().uuid().optional(),
  supplierInvoiceNo: z.string().max(80).optional(), dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: z.string().max(1000).optional(),
  lines: json.pipe(z.array(grnLineInput).min(1, "Add at least one product").max(1000)),
});

export async function receiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await requireWrite("stock.receive");
    const o = schema.parse(formObject(fd));
    const file = fd.get("invoice");
    let upload: { key: string; name: string; mime: string; size: number } | null = null;
    if (file instanceof File && file.size > 0) {
      if (!ALLOWED_MIME.test(file.type)) throw new UserError("Attach the invoice as a photo (JPG, PNG, WebP) or a PDF");
      if (file.size > MAX_UPLOAD_BYTES) throw new UserError("The invoice file is too large (15 MB max)");
      upload = { key: await putFile(ctx.tenant.id, file.name, Buffer.from(await file.arrayBuffer()), file.type), name: file.name.slice(0, 200), mime: file.type, size: file.size };
    }
    const id = await tx(ctx, async (t) => {
      const grn = await receiveGoods(t, ctx, o);
      if (upload) await t.insert(documents).values({ tenantId: ctx.tenant.id, entity: "goods_receipt", entityId: grn.id, name: upload.name, mime: upload.mime, size: upload.size, storageKey: upload.key, uploadedBy: ctx.user.id });
      return grn.id;
    });
    revalidatePath("/receiving");
    revalidatePath("/purchasing");
    return { ok: true, id };
  });
}
