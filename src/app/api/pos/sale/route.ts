import { z } from "zod";
import { UserError } from "@/lib/action";
import { AuthError, getCtx, requireWrite, tx } from "@/lib/auth";
import { createSale, saleInput } from "@/lib/sales";
import { loadReceipt } from "@/app/(app)/sales/data";

/** Online sale from the till. Errors the cashier can fix come back as { error } with status 400. */
export async function POST(req: Request) {
  // 401 = signed out (the till keeps the sale on the device); 403 = not allowed (it doesn't).
  if (!(await getCtx())) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  try {
    const ctx = await requireWrite("pos.sell");
    const input = saleInput.parse(await req.json());
    const result = await tx(ctx, async (t) => {
      const sale = await createSale(t, ctx, input);
      return { id: sale.id, saleNo: sale.saleNo, receipt: await loadReceipt(t, ctx.tenant, sale.id) };
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: 403 });
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof z.ZodError) return Response.json({ error: "Some sale details are not valid. Check the cart and try again." }, { status: 400 });
    console.error("pos sale", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
