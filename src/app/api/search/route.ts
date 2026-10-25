import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { customers, sales } from "@/db/schema";
import { audit, getCtx, tx } from "@/lib/auth";
import { searchProducts } from "@/lib/catalog";
import { e164, money } from "@/lib/format";
import { can } from "@/lib/permissions";

export type SearchResult = { type: "product" | "customer" | "sale"; id: string; title: string; subtitle: string; href: string };

/** Command palette search: products (name / generic / barcode), customers (name / phone / no.) and sales (number). */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return Response.json({ results: [] }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return Response.json({ results: [] });
  const role = ctx.user.role;
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const digits = q.replace(/\D/g, "");
  const results = await tx(ctx, async (t) => {
    const out: SearchResult[] = [];
    if (can(role, "stock.view") || can(role, "pos.sell")) {
      for (const r of await searchProducts(t, q, ctx.branchId, 6)) {
        out.push({
          type: "product", id: r.product.id, title: [r.product.name, r.product.strength].filter(Boolean).join(" "),
          subtitle: [r.product.genericName, `${r.onHand} ${r.product.baseUnit} in stock`, r.nextExpiry && `next expiry ${r.nextExpiry}`].filter(Boolean).join(" · "),
          href: can(role, "stock.view") ? `/products/${r.product.id}` : `/pos`,
        });
      }
    }
    if (can(role, "customers.read")) {
      const phone = digits.length >= 6 ? e164(q, ctx.tenant.country) : null;
      const found = await t.select({ id: customers.id, name: customers.name, no: customers.customerNo, phone: customers.phone, balance: customers.balanceMinor }).from(customers)
        .where(and(isNull(customers.deletedAt), or(ilike(customers.name, like), ilike(customers.customerNo, like), phone ? eq(customers.phone, phone) : undefined)))
        .orderBy(customers.name).limit(6);
      if (found.length) await audit(t, ctx, "search", "customer", null, { details: { results: found.length } });
      for (const c of found) out.push({ type: "customer", id: c.id, title: c.name, subtitle: [c.no, c.phone, c.balance > 0 && `owes ${money(c.balance, ctx.tenant.currency)}`].filter(Boolean).join(" · "), href: `/customers/${c.id}` });
    }
    if (can(role, "pos.sell") && /\d/.test(q)) {
      const term = /^sl-?/i.test(q) ? q : `SL-${digits.padStart(6, "0")}`;
      const found = await t.select({ id: sales.id, no: sales.saleNo, total: sales.totalMinor, soldAt: sales.soldAt, status: sales.status }).from(sales)
        .where(or(eq(sales.saleNo, term.toUpperCase()), ilike(sales.saleNo, `%${digits}%`))).orderBy(desc(sales.soldAt)).limit(4);
      for (const s of found) out.push({ type: "sale", id: s.id, title: `Sale ${s.no}`, subtitle: `${money(s.total, ctx.tenant.currency)} · ${s.status.replace("_", " ")}`, href: `/sales/${s.id}` });
    }
    return out;
  });
  return Response.json({ results });
}
