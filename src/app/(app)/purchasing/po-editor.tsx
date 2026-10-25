"use client";
import { Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { Field, IconButton, Input, Panel, Select, Table, Td, Textarea } from "@/components/ui";
import { savePoAction } from "./actions";
import type { CatalogItem } from "./catalog";
import { itemLabel, ProductSearch } from "./product-search";
import { toMinor } from "./status";

type Line = { key: string; productId: string; unitId: string; qty: string; cost: string };
type Supplier = { id: string; name: string };

const fmt = (minor: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 100);

/** New / edit purchase order: pick a supplier, scan or search products, choose pack and qty; cost comes from the supplier's price. */
export function PoEditor({ catalog, suppliers, currency, initial }: {
  catalog: CatalogItem[]; suppliers: Supplier[]; currency: string;
  initial?: { id: string; supplierId: string; notes: string | null; expectedAt: string | null; lines: { productId: string; unitId: string; qty: number; unitCostMinor: number }[] } | { supplierId: string };
}) {
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [lines, setLines] = useState<Line[]>(() => (initial && "lines" in initial ? initial.lines : []).map((l, i) => ({ key: `i${i}`, productId: l.productId, unitId: l.unitId, qty: String(l.qty), cost: (l.unitCostMinor / 100).toFixed(2) })));
  const qtyRefs = useRef(new Map<string, HTMLInputElement>());
  const search = useRef<HTMLInputElement>(null);

  const priceOf = (p: CatalogItem, unitId: string, sup = supplierId) => p.prices.find((x) => x.supplierId === sup && x.unitId === unitId)?.costMinor;
  const defaultUnit = (p: CatalogItem) => p.prices.find((x) => x.supplierId === supplierId)?.unitId ?? [...p.units].sort((a, b) => b.factor - a.factor)[0]?.id ?? "";
  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const add = (p: CatalogItem, unitId?: string) => {
    const existing = lines.find((l) => l.productId === p.id && (!unitId || l.unitId === unitId));
    if (existing) {
      set(existing.key, { qty: String((Number(existing.qty) || 0) + 1) });
      qtyRefs.current.get(existing.key)?.focus();
      return;
    }
    const u = unitId ?? defaultUnit(p);
    if (!u) return;
    const key = `n${Date.now()}${Math.random()}`;
    const c = priceOf(p, u);
    setLines((ls) => [...ls, { key, productId: p.id, unitId: u, qty: "1", cost: c != null ? (c / 100).toFixed(2) : "" }]);
    setTimeout(() => qtyRefs.current.get(key)?.select(), 0);
  };

  const changeSupplier = (sid: string) => {
    setSupplierId(sid);
    setLines((ls) => ls.map((l) => { const c = priceOf(byId.get(l.productId)!, l.unitId, sid); return c != null ? { ...l, cost: (c / 100).toFixed(2) } : l; }));
  };

  const parsed = lines.map((l) => ({ productId: l.productId, unitId: l.unitId, qty: Math.max(0, Math.floor(Number(l.qty) || 0)), unitCostMinor: toMinor(l.cost || "0") ?? 0 }));
  const total = parsed.reduce((s, l) => s + l.qty * l.unitCostMinor, 0);
  const id = initial && "id" in initial ? initial.id : undefined;

  return (
    <ActionForm action={savePoAction} onSuccessHref="/purchasing/{id}" className="space-y-6">
      {id && <input type="hidden" name="id" value={id} />}
      <input type="hidden" name="lines" value={JSON.stringify(parsed.filter((l) => l.qty > 0))} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Products" eyebrow="Order lines" bodyClassName="space-y-4 p-5">
          <ProductSearch catalog={catalog} onPick={add} inputRef={search} autoFocus={!id} />
          <Table head={["Product", "Pack", "Qty", "Cost per pack", "Line total", ""]} empty="Scan or search to add products">
            {lines.map((l, i) => {
              const p = byId.get(l.productId);
              if (!p) return null;
              const line = parsed[i];
              return (
                <tr key={l.key}>
                  <Td className="max-w-64 truncate font-medium">{itemLabel(p)}</Td>
                  <Td>
                    <Select aria-label="Pack" value={l.unitId} className="h-9 min-w-32" onChange={(e) => { const c = priceOf(p, e.target.value); set(l.key, { unitId: e.target.value, ...(c != null ? { cost: (c / 100).toFixed(2) } : {}) }); }}>
                      {p.units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.factor > 1 ? ` (${u.factor})` : ""}</option>)}
                    </Select>
                  </Td>
                  <Td><Input aria-label="Quantity" type="number" min={1} inputMode="numeric" value={l.qty} className="h-9 w-20 tabular-nums"
                    ref={(el) => { if (el) qtyRefs.current.set(l.key, el); else qtyRefs.current.delete(l.key); }}
                    onChange={(e) => set(l.key, { qty: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search.current?.focus(); } }} /></Td>
                  <Td><Input aria-label="Cost per pack" inputMode="decimal" value={l.cost} placeholder="0.00" className="h-9 w-28 tabular-nums"
                    onChange={(e) => set(l.key, { cost: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search.current?.focus(); } }} /></Td>
                  <Td className="tabular-nums">{fmt(line.qty * line.unitCostMinor, currency)}</Td>
                  <Td><IconButton type="button" label="Remove line" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton></Td>
                </tr>
              );
            })}
          </Table>
        </Panel>
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Order" eyebrow="Supplier" bodyClassName="space-y-4 p-5">
            <Field label="Supplier">
              <Select name="supplierId" value={supplierId} required onChange={(e) => changeSupplier(e.target.value)}>
                <option value="">Choose a supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Expected delivery"><Input type="date" name="expectedAt" defaultValue={initial && "expectedAt" in initial ? initial.expectedAt ?? "" : ""} /></Field>
            <Field label="Note to supplier"><Textarea name="notes" defaultValue={initial && "notes" in initial ? initial.notes ?? "" : ""} placeholder="Delivery instructions, payment terms…" /></Field>
            <div className="flex items-end justify-between border-t border-line pt-4">
              <span className="text-xs text-muted">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
              <span className="text-2xl font-semibold tabular-nums text-fg">{fmt(total, currency)}</span>
            </div>
            <Submit className="w-full" size="lg" disabled={!lines.length || !supplierId}>{id ? "Save changes" : "Save draft order"}</Submit>
          </Panel>
        </div>
      </div>
    </ActionForm>
  );
}
