import { and, eq } from "drizzle-orm";
import { documents, prescriptions } from "@/db/schema";
import { AuthError, audit, getCtx, requireWrite, tx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { ALLOWED_MIME, getFile, MAX_UPLOAD_BYTES, putFile } from "@/lib/storage";

const isId = (s: string | null): s is string => !!s && /^[0-9a-f-]{36}$/.test(s);

/** Opens an attached prescription document (audited). */
export async function GET(req: Request, { params }: RouteContext<"/prescriptions/[id]/file">) {
  const ctx = await getCtx();
  if (!ctx || !can(ctx.user.role, "prescriptions.read")) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const docId = new URL(req.url).searchParams.get("doc");
  if (!isId(id) || !isId(docId)) return new Response("Not found", { status: 404 });
  const doc = await tx(ctx, async (t) => {
    const [d] = await t.select().from(documents).where(and(eq(documents.id, docId), eq(documents.entityId, id), eq(documents.entity, "prescription")));
    if (!d) return null;
    const [rx] = await t.select({ customerId: prescriptions.customerId }).from(prescriptions).where(eq(prescriptions.id, id));
    await audit(t, ctx, "view", "document", d.id, { customerId: rx?.customerId, details: { prescription: id } });
    return d;
  });
  if (!doc) return new Response("Not found", { status: 404 });
  const data = await getFile(ctx.tenant.id, doc.storageKey);
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": doc.mime, "Content-Disposition": `inline; filename="${doc.name.replace(/["\\\r\n]/g, "")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Uploads a photo / PDF of the paper prescription (multipart form post; a route so large photos aren't capped). */
export async function POST(req: Request, { params }: RouteContext<"/prescriptions/[id]/file">) {
  const { id } = await params;
  const back = (q: string) => Response.redirect(new URL(`/prescriptions/${id}?${q}`, req.url), 303);
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  if (!isId(id)) return new Response("Not found", { status: 404 });
  try {
    const ctx = await requireWrite("prescriptions.write");
    if (!hasFeature(ctx.tenant, "prescriptions")) return back("error=plan");
    const file = (await req.formData()).get("file");
    if (!(file instanceof File) || !file.size) return back("error=empty");
    if (file.size > MAX_UPLOAD_BYTES) return back("error=size");
    if (!ALLOWED_MIME.test(file.type) || file.type.startsWith("text/")) return back("error=type");
    const ok = await tx(ctx, async (t) => (await t.select({ id: prescriptions.id }).from(prescriptions).where(eq(prescriptions.id, id))).length > 0);
    if (!ok) return new Response("Not found", { status: 404 });
    const key = await putFile(ctx.tenant.id, file.name, Buffer.from(await file.arrayBuffer()), file.type);
    await tx(ctx, async (t) => {
      const [d] = await t.insert(documents).values({ tenantId: ctx.tenant.id, entity: "prescription", entityId: id, name: file.name.slice(0, 200), mime: file.type, size: file.size, storageKey: key, uploadedBy: ctx.user.id }).returning({ id: documents.id });
      const [rx] = await t.update(prescriptions).set({ documentKey: key }).where(eq(prescriptions.id, id)).returning({ customerId: prescriptions.customerId });
      await audit(t, ctx, "create", "document", d.id, { customerId: rx?.customerId, details: { prescription: id } });
    });
    return back("uploaded=1");
  } catch (e) {
    if (e instanceof AuthError) return back("error=auth");
    throw e;
  }
}
