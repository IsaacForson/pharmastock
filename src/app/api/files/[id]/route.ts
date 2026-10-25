import { eq } from "drizzle-orm";
import { documents, prescriptions } from "@/db/schema";
import { audit, getCtx, tx } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { getFile } from "@/lib/storage";

/** Who may open a stored file, by what it belongs to. The logo is printed on everyone's receipts. */
const NEEDS: Record<string, Permission | null> = {
  logo: null, prescription: "prescriptions.read", goods_receipt: "stock.view", supplier_return: "stock.view", import: "products.write",
};

export async function GET(_: Request, { params }: RouteContext<"/api/files/[id]">) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const doc = await tx(ctx, async (t) => {
    const [d] = await t.select().from(documents).where(eq(documents.id, id));
    if (!d) return null;
    const need = d.entity in NEEDS ? NEEDS[d.entity] : "settings.manage";
    if (need && !can(ctx.user.role, need)) return "forbidden" as const;
    let customerId: string | null = null;
    if (d.entity === "prescription" && d.entityId) {
      [{ customerId } = { customerId: null }] = await t.select({ customerId: prescriptions.customerId }).from(prescriptions).where(eq(prescriptions.id, d.entityId));
    }
    if (d.entity !== "logo") await audit(t, ctx, "view", "document", d.id, { customerId, details: { entity: d.entity, entityId: d.entityId } });
    return d;
  });
  if (doc === "forbidden") return new Response("Forbidden", { status: 403 });
  if (!doc) return new Response("Not found", { status: 404 });
  const data = await getFile(ctx.tenant.id, doc.storageKey);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": doc.mime, "Content-Disposition": `inline; filename="${doc.name.replace(/"/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
