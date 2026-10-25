"use client";
import { AlertTriangle, Copy, Paperclip, Trash2, XOctagon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { cx, Field, IconButton, Input, Kbd, Panel, Select, Textarea } from "@/components/ui";
import type { CatalogItem } from "../purchasing/catalog";
import { itemLabel, ProductSearch } from "../purchasing/product-search";
import { toMinor } from "../purchasing/status";
import { receiveAction } from "./actions";
import { daysUntil, parseExpiry } from "./expiry";

export type DraftLine = { productId: string; unitId: string; poLineId?: string; qty: number; cost: number };
type Line = { key: string; productId: string; unitId: string; poLineId?: string; qty: string; free: string; batch: string; expiry: string; mfg: string; cost: string };
type Supplier = { id: string; name: string; paymentTermsDays: number };
type Issue = { level: "error" | "warn"; text: string };

const COLS = ["qty", "free", "batch", "expiry", "mfg", "cost"] as const;
let seq = 0;
const newKey = () => `l${++seq}`;
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nice = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Fast goods-received flow: scan → pack → qty + free → batch → expiry (→ mfg) → cost, with live warnings. */
export function GrnWorkspace({ catalog, suppliers, openPos, po, initialLines, today, alertDays, currency }: {
  catalog: CatalogItem[]; suppliers: Supplier[]; openPos: { id: string; poNo: string; supplierId: string }[]; po: { id: string; poNo: string; supplierId: string } | null;
  initialLines: DraftLine[]; today: string; alertDays: number; currency: string;
}) {
  const fmt = (m: number) => new Intl.NumberFormat("en", { style: "currency", currency }).format(m / 100);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? "");
  const [dueAt, setDueAt] = useState<string | null>(null); // null = from supplier terms
  const [lines, setLines] = useState<Line[]>(() => initialLines.map((l) => ({ key: newKey(), productId: l.productId, unitId: l.unitId, poLineId: l.poLineId, qty: String(l.qty), free: "", batch: "", expiry: "", mfg: "", cost: (l.cost / 100).toFixed(2) })));
  const search = useRef<HTMLInputElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const sup = suppliers.find((s) => s.id === supplierId);
  const due = dueAt ?? (sup ? addDays(today, sup.paymentTermsDays) : "");

  const focus = (key: string, col: number) => setTimeout(() => {
    const el = table.current?.querySelector<HTMLInputElement>(`[data-row="${key}"][data-col="${col}"]`);
    if (el) { el.focus(); el.select(); } else search.current?.focus();
  }, 0);
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const costFor = (p: CatalogItem, unitId: string) => {
    const q = p.prices.find((x) => x.supplierId === supplierId && x.unitId === unitId)?.costMinor;
    const f = p.units.find((u) => u.id === unitId)?.factor ?? 1;
    const c = q ?? (p.lastCostPerBase != null ? Math.round(p.lastCostPerBase * f) : null);
    return c != null ? (c / 100).toFixed(2) : "";
  };

  const add = (p: CatalogItem, unitId?: string) => {
    const waiting = lines.find((l) => l.productId === p.id && !l.batch && (!unitId || l.unitId === unitId));
    if (waiting) return focus(waiting.key, 0);
    const u = unitId ?? p.prices.find((x) => x.supplierId === supplierId)?.unitId ?? [...p.units].sort((a, b) => b.factor - a.factor)[0]?.id;
    if (!u) return;
    const prev = [...lines].reverse().find((l) => l.productId === p.id && l.unitId === u);
    const key = newKey();
    setLines((ls) => [...ls, { key, productId: p.id, unitId: u, poLineId: prev?.poLineId, qty: "1", free: "", batch: "", expiry: "", mfg: "", cost: prev?.cost ?? costFor(p, u) }]);
    focus(key, 0);
  };
  const split = (l: Line) => {
    const key = newKey();
    setLines((ls) => { const i = ls.findIndex((x) => x.key === l.key); const n = [...ls]; n.splice(i + 1, 0, { ...l, key, qty: "", free: "", batch: "", expiry: "", mfg: "" }); return n; });
    focus(key, 0);
  };

  const issues = (l: Line, p: CatalogItem): Issue[] => {
    const out: Issue[] = [];
    const exp = parseExpiry(l.expiry);
    const qty = Number(l.qty) || 0, free = Number(l.free) || 0;
    if (qty + free <= 0) out.push({ level: "error", text: "Enter a quantity" });
    if (l.expiry && !exp) out.push({ level: "error", text: "Expiry not understood. Type it like 03/27" });
    if (l.mfg && !parseExpiry(l.mfg)) out.push({ level: "error", text: "Manufacture date not understood" });
    if (exp) {
      const left = daysUntil(today, exp);
      if (left < 0) out.push({ level: "error", text: "Already expired. Don't receive it" });
      else if (left <= alertDays) out.push({ level: "warn", text: `Short expiry: ${left} days left` });
    } else if (p.schedule !== "non_drug" && !l.expiry) out.push({ level: "warn", text: "No expiry date" });
    if (p.schedule !== "non_drug" && !l.batch.trim()) out.push({ level: "warn", text: "No batch number" });
    const known = l.batch.trim() && p.batches?.find((b) => b.batchNo === l.batch.trim().toUpperCase());
    if (known && exp && known.expiry && known.expiry !== exp) out.push({ level: "warn", text: `Batch ${known.batchNo} is on file with expiry ${nice(known.expiry)}` });
    const cost = toMinor(l.cost || "");
    if (l.cost && cost === null) out.push({ level: "error", text: "Cost not understood" });
    const f = p.units.find((u) => u.id === l.unitId)?.factor ?? 1;
    if (cost && p.lastCostPerBase) {
      const change = cost / f / p.lastCostPerBase - 1;
      if (Math.abs(change) >= 0.15) out.push({ level: "warn", text: `Cost ${change > 0 ? "up" : "down"} ${Math.round(Math.abs(change) * 100)}% on last delivery` });
    }
    return out;
  };

  const rows = lines.map((l) => ({ l, p: byId.get(l.productId)! })).filter((r) => r.p);
  const checked = rows.map((r) => ({ ...r, issues: issues(r.l, r.p) }));
  const errors = checked.filter((r) => r.issues.some((i) => i.level === "error")).length;
  const warns = checked.filter((r) => r.issues.some((i) => i.level === "warn")).length;
  const payload = rows.map(({ l }) => ({
    productId: l.productId, unitId: l.unitId, poLineId: l.poLineId ?? null, qty: Math.floor(Number(l.qty) || 0), freeQty: Math.floor(Number(l.free) || 0),
    unitCostMinor: toMinor(l.cost || "0") ?? 0, batchNo: l.batch.trim(), expiry: parseExpiry(l.expiry), mfgDate: parseExpiry(l.mfg),
  })).filter((l) => l.qty + l.freeQty > 0);
  const total = payload.reduce((s, l) => s + l.qty * l.unitCostMinor, 0);

  const cell = (l: Line, col: number, extra: Omit<React.ComponentProps<typeof Input>, "onKeyDown">) => (
    <Input data-row={l.key} data-col={col} {...extra}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); focus(l.key, col === COLS.length - 1 ? 99 : col + 1); } }} />
  );

  return (
    <ActionForm action={receiveAction} onSuccessHref="/receiving/{id}" className="space-y-6">
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      {po && <input type="hidden" name="poId" value={po.id} />}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Products received" eyebrow={`${rows.length} line${rows.length === 1 ? "" : "s"}`} bodyClassName="space-y-4 p-5"
          actions={<span className="hidden items-center gap-1.5 text-xs text-subtle md:inline-flex"><Kbd>Enter</Kbd> next box · scan anytime</span>}>
          <ProductSearch catalog={catalog} onPick={add} inputRef={search} autoFocus />
          <div ref={table} className="-mx-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="border-b border-line text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">
                {["Product / pack", "Qty", "Free", "Batch no.", "Expiry", "Mfg", "Cost per pack", ""].map((h) => <th key={h} className="whitespace-nowrap px-2 pb-3 first:pl-5">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line">
                {checked.map(({ l, p, issues: is }) => {
                  const exp = parseExpiry(l.expiry);
                  const bad = is.some((i) => i.level === "error");
                  return (
                    <tr key={l.key} className={cx("align-top", bad && "bg-bad/5")}>
                      <td className="py-2.5 pl-5 pr-2">
                        <div className="max-w-56 truncate font-medium text-fg">{itemLabel(p)}</div>
                        <Select aria-label="Pack" value={l.unitId} className="mt-1 h-8 min-w-32 text-xs" onChange={(e) => set(l.key, { unitId: e.target.value, cost: costFor(p, e.target.value) || l.cost })}>
                          {p.units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.factor > 1 ? ` (${u.factor})` : ""}</option>)}
                        </Select>
                        {is.length > 0 && (
                          <ul className="mt-1.5 space-y-0.5">
                            {is.map((i) => <li key={i.text} className={cx("flex items-center gap-1 text-xs", i.level === "error" ? "text-bad" : "text-warn")}>
                              {i.level === "error" ? <XOctagon className="h-3 w-3 shrink-0" aria-hidden /> : <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}{i.text}</li>)}
                          </ul>
                        )}
                      </td>
                      <td className="px-2 py-2.5">{cell(l, 0, { "aria-label": "Quantity", type: "number", min: 0, inputMode: "numeric", value: l.qty, className: "h-9 w-20 tabular-nums", onChange: (e) => set(l.key, { qty: e.target.value }) })}</td>
                      <td className="px-2 py-2.5">{cell(l, 1, { "aria-label": "Free quantity", type: "number", min: 0, inputMode: "numeric", value: l.free, placeholder: "0", className: "h-9 w-16 tabular-nums", onChange: (e) => set(l.key, { free: e.target.value }) })}</td>
                      <td className="px-2 py-2.5">{cell(l, 2, { "aria-label": "Batch number", value: l.batch, className: "h-9 w-32 font-mono uppercase", autoCapitalize: "characters", onChange: (e) => set(l.key, { batch: e.target.value }) })}</td>
                      <td className="px-2 py-2.5">
                        {cell(l, 3, { "aria-label": "Expiry", value: l.expiry, placeholder: "MM/YY", className: "h-9 w-28 tabular-nums", onChange: (e) => set(l.key, { expiry: e.target.value }) })}
                        {exp && <div className="mt-1 text-[11px] text-muted">{nice(exp)}</div>}
                      </td>
                      <td className="px-2 py-2.5">{cell(l, 4, { "aria-label": "Manufacture date", value: l.mfg, placeholder: "opt.", className: "h-9 w-24 tabular-nums", onChange: (e) => set(l.key, { mfg: e.target.value }) })}</td>
                      <td className="px-2 py-2.5">{cell(l, 5, { "aria-label": "Cost per pack", inputMode: "decimal", value: l.cost, placeholder: "0.00", className: "h-9 w-28 tabular-nums", onChange: (e) => set(l.key, { cost: e.target.value }) })}</td>
                      <td className="whitespace-nowrap py-2.5 pl-2 pr-5">
                        <div className="flex gap-1">
                          <IconButton type="button" label="Another batch of this product" onClick={() => split(l)}><Copy className="h-4 w-4" /></IconButton>
                          <IconButton type="button" label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && <p className="py-10 text-center text-sm text-muted">Scan the first product to start.</p>}
          </div>
        </Panel>

        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Panel title="Delivery" eyebrow={po ? po.poNo : "Ad hoc"} bodyClassName="space-y-4 p-5">
            <Field label="Supplier">
              <Select name="supplierId" value={supplierId} disabled={!!po} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">No supplier (found stock, donation…)</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            {!po && supplierId && openPos.some((x) => x.supplierId === supplierId) && (
              <p className="text-xs text-muted">Open orders from this supplier: {openPos.filter((x) => x.supplierId === supplierId).map((x, i) => <span key={x.id}>{i ? ", " : ""}<a className="text-accent hover:underline" href={`/receiving/new?po=${x.id}`}>{x.poNo}</a></span>)}</p>
            )}
            <Field label="Supplier invoice no."><Input name="supplierInvoiceNo" placeholder="e.g. INV-20431" /></Field>
            <Field label="Payment due" hint={sup && dueAt === null ? `${sup.paymentTermsDays} days from today (supplier terms)` : undefined}>
              <Input type="date" name="dueAt" value={due} onChange={(e) => setDueAt(e.target.value)} />
            </Field>
            <Field label="Invoice photo or PDF">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-2 px-3 text-sm text-muted hover:text-fg">
                <Paperclip className="h-4 w-4" aria-hidden /><input type="file" name="invoice" accept="image/*,application/pdf" capture="environment" className="min-w-0 flex-1 text-xs file:hidden" />
              </label>
            </Field>
            <Field label="Notes"><Textarea name="notes" rows={2} placeholder="Damaged cartons, short delivery…" /></Field>
            <div className="space-y-1 border-t border-line pt-4 text-sm">
              <div className="flex justify-between text-muted"><span>Lines</span><span className="tabular-nums">{payload.length}</span></div>
              {warns > 0 && <div className="flex justify-between text-warn"><span>Lines with warnings</span><span className="tabular-nums">{warns}</span></div>}
              {errors > 0 && <div className="flex justify-between text-bad"><span>Lines to fix</span><span className="tabular-nums">{errors}</span></div>}
              <div className="flex items-end justify-between pt-2"><span className="text-muted">Invoice total</span><span className="text-2xl font-semibold tabular-nums text-fg">{fmt(total)}</span></div>
            </div>
            <Submit size="lg" className="w-full" disabled={!payload.length || errors > 0}>Receive into stock</Submit>
          </Panel>
        </div>
      </div>
    </ActionForm>
  );
}
