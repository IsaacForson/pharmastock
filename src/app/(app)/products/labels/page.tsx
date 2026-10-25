import { outer } from "@/db";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ArrowLeft, Barcode, Search, Tags } from "lucide-react";
import { ActionForm, PrintButton, Submit } from "@/components/form";
import { Badge, Button, Check, cx, Field, Input, LinkButton, PageHeader, Panel, Select } from "@/components/ui";
import { barcodes, productUnits, products } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { code128Svg } from "@/lib/barcode";
import { money } from "@/lib/format";
import { can } from "@/lib/permissions";
import { generateBarcodesAction } from "./actions";

export const metadata = { title: "Labels" };

const MAX_LABELS = 600;
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function LabelsPage({ searchParams }: PageProps<"/products/labels">) {
  const ctx = await requireCtx("stock.view");
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim().slice(0, 80);
  const missing = sp.missing === "1";
  const layout = sp.layout === "sticker" ? "sticker" : "shelf";
  const selected = list(sp.p).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 300);
  const qtyOf = (id: string) => Math.min(Math.max(Number(list(sp[`n_${id}`])[0] ?? 1) || 0, 0), 100);

  const rows = await tx(ctx, (t) => t.select({
    id: products.id, name: products.name, strength: products.strength, form: products.form,
    // Single-table select: Drizzle leaves outer columns unqualified, so the correlated subqueries name tables explicitly.
    price: sql<number | null>`(select pu.sell_price_minor from product_units pu where pu.product_id = "products"."id" order by pu.is_default desc, pu.factor asc limit 1)`,
    unitName: sql<string | null>`(select pu.name from product_units pu where pu.product_id = "products"."id" order by pu.is_default desc, pu.factor asc limit 1)`,
    code: sql<string | null>`(select b.code from barcodes b left join product_units pu on pu.id = b.unit_id where b.product_id = "products"."id" order by pu.is_default desc nulls last, b.code limit 1)`,
  }).from(products).where(and(eq(products.active, true), or(
    selected.length ? inArray(products.id, selected) : undefined,
    and(
      q ? or(ilike(products.name, `%${q}%`), ilike(products.genericName, `%${q}%`), sql`exists (select 1 from ${barcodes} where ${barcodes.productId} = ${outer(products.id)} and ${barcodes.code} = ${q})`) : undefined,
      missing ? sql`not exists (select 1 from ${barcodes} where ${barcodes.productId} = ${outer(products.id)})` : undefined,
    ),
  ))).orderBy(...(selected.length ? [sql`${inArray(products.id, selected)} desc`] : []), asc(products.name)).limit(60 + selected.length));

  const chosen = rows.filter((r) => selected.includes(r.id));
  const labels = chosen.flatMap((r) => Array.from({ length: qtyOf(r.id) }, () => r)).slice(0, MAX_LABELS);
  const lacking = chosen.filter((r) => !r.code);
  const cur = ctx.tenant.currency;

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <PageHeader icon={<Tags />} eyebrow="Products" title="Shelf labels & stickers"
          subtitle="Pick products and how many labels of each, then print the sheet."
          actions={<><LinkButton href="/products" variant="ghost"><ArrowLeft className="h-4 w-4" aria-hidden /> Products</LinkButton>{labels.length > 0 && <PrintButton />}</>} />

        <form>
          <Panel title="Choose products" icon={<Search />}>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <Field label="Search" className="min-w-56 flex-1"><Input name="q" defaultValue={q} placeholder="Name, generic name or barcode" /></Field>
              <Field label="Label size">
                <Select name="layout" defaultValue={layout}><option value="shelf">Shelf / price label (3 across)</option><option value="sticker">Small sticker (5 across)</option></Select>
              </Field>
              <Check name="missing" value="1" defaultChecked={missing} label="Only products without a barcode" className="h-10" />
              <Button variant="secondary">Search</Button>
            </div>
            {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No products match. Try another search.</p> : (
              <ul className="grid max-h-[28rem] gap-1 overflow-y-auto sm:grid-cols-2">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded px-3 py-2 hover:bg-surface-2">
                    <input type="checkbox" name="p" value={r.id} defaultChecked={selected.includes(r.id)} aria-label={`Print labels for ${r.name}`} className="h-4 w-4 accent-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{r.name} <span className="text-muted">{r.strength}</span></span>
                      <span className="block truncate text-xs text-muted">{r.price != null ? `${money(r.price, cur)} / ${r.unitName}` : "No price"} · {r.code ? <span className="font-mono">{r.code}</span> : "No barcode"}</span>
                    </span>
                    <Input name={`n_${r.id}`} type="number" min={0} max={100} defaultValue={selected.includes(r.id) ? qtyOf(r.id) : 1} aria-label={`Number of labels for ${r.name}`} className="w-20 text-right" />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end"><Button>Make label sheet</Button></div>
          </Panel>
        </form>

        {lacking.length > 0 && can(ctx.user.role, "products.write") && (
          <Panel className="mt-6" icon={<Barcode />} title={`${lacking.length} chosen product${lacking.length > 1 ? "s have" : " has"} no barcode`}>
            <ActionForm action={generateBarcodesAction} className="flex flex-wrap items-center justify-between gap-3">
              {lacking.map((r) => <input key={r.id} type="hidden" name="productId" value={r.id} />)}
              <p className="text-sm text-muted">Make an internal barcode for each so they can be scanned at the till.</p>
              <Submit variant="secondary">Make barcodes</Submit>
            </ActionForm>
          </Panel>
        )}
      </div>

      {labels.length > 0 && (
        <section aria-label="Label sheet" className="sheet p-4 print:border-0 print:p-0 print:shadow-none">
          <div className="mb-3 flex items-center justify-between print:hidden">
            <span className="text-sm text-muted">{labels.length} label{labels.length > 1 ? "s" : ""}{labels.length === MAX_LABELS ? " (most per sheet)" : ""}</span>
            <Badge tone="teal">{layout === "shelf" ? "Shelf labels" : "Stickers"}</Badge>
          </div>
          <div className={cx("grid gap-2 print:gap-1", layout === "shelf" ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-3 sm:grid-cols-5")}>
            {labels.map((r, i) => (
              <div key={i} className={cx("flex break-inside-avoid flex-col items-center justify-between rounded border border-line bg-surface text-center text-fg print:rounded-none",
                layout === "shelf" ? "min-h-36 p-3" : "min-h-24 p-1.5")}>
                <div className={cx("w-full font-semibold leading-tight", layout === "shelf" ? "text-sm" : "truncate text-[10px]")}>{r.name}</div>
                <div className={cx("text-muted", layout === "shelf" ? "text-xs" : "text-[9px]")}>{[r.strength, r.form].filter(Boolean).join(" · ")}</div>
                {layout === "shelf" && <div className="my-1 text-xl font-bold tabular-nums">{r.price != null ? money(r.price, cur) : ""}<span className="text-xs font-normal text-muted"> {r.unitName ? `/ ${r.unitName}` : ""}</span></div>}
                {r.code
                  // Our own encoder output; the text is XML-escaped.
                  ? <div className="w-full [&>svg]:mx-auto [&>svg]:h-auto [&>svg]:max-w-full" dangerouslySetInnerHTML={{ __html: code128Svg(r.code, { height: layout === "shelf" ? 36 : 22, moduleWidth: 1 }) }} />
                  : <div className="text-[10px] text-subtle">No barcode</div>}
                {layout === "sticker" && r.price != null && <div className="text-[11px] font-bold tabular-nums">{money(r.price, cur)}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
