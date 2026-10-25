"use client";
import { Barcode, Layers, Package, Plus, ScanLine, Tag, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { CameraScanner, useWedgeScanner } from "@/components/scanner";
import { Badge, Button, Check, Field, IconButton, Input, Panel, Select, cx } from "@/components/ui";
import { saveProductAction } from "./actions";

type UnitRow = { key: string; id?: string; name: string; factor: number; price: string; sellable: boolean; isDefault: boolean; barcodes: string[] };
export type ProductFormDefaults = {
  id?: string; name?: string; genericName?: string | null; strength?: string | null; form?: string | null; manufacturer?: string | null;
  categoryId?: string | null; schedule?: string; baseUnit?: string; taxBp?: number | null; reorderLevel?: number; reorderQty?: number;
  preferredSupplierId?: string | null; shelf?: string | null; favorite?: boolean; active?: boolean;
  units?: { id: string; name: string; factor: number; sellPriceMinor: number; sellable: boolean; isDefault: boolean; barcodes: string[] }[];
};

const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "cream", "ointment", "drops", "inhaler", "sachet", "suppository", "solution", "device", "other"];
let seq = 0;
const key = () => `u${++seq}`;

export function ProductForm({ d, categories, suppliers, scheduleLabels, canPrice, defaultTaxPercent }: {
  d: ProductFormDefaults; categories: { id: string; name: string }[]; suppliers: { id: string; name: string }[];
  scheduleLabels: Record<string, string>; canPrice: boolean; defaultTaxPercent: string;
}) {
  const [baseUnit, setBaseUnit] = useState(d.baseUnit ?? "tablet");
  const [units, setUnits] = useState<UnitRow[]>(() => d.units?.length
    ? d.units.map((u) => ({ key: key(), id: u.id, name: u.name, factor: u.factor, price: (u.sellPriceMinor / 100).toFixed(2), sellable: u.sellable, isDefault: u.isDefault, barcodes: u.barcodes }))
    : [{ key: key(), name: d.baseUnit ?? "tablet", factor: 1, price: "", sellable: true, isDefault: true, barcodes: [] }]);
  const [scanInto, setScanInto] = useState(units.find((u) => u.isDefault)?.key ?? units[0]?.key);
  const [codeDraft, setCodeDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const patch = (k: string, p: Partial<UnitRow>) => setUnits((us) => us.map((u) => (u.key === k ? { ...u, ...p } : p.isDefault ? { ...u, isDefault: false } : u)));
  const addCode = useCallback((k: string | undefined, raw: string) => {
    const code = raw.trim();
    if (!k || code.length < 3) return;
    setUnits((us) => {
      const owner = us.find((u) => u.barcodes.includes(code));
      if (owner) { setNote(`${code} is already on "${owner.name}"`); return us; }
      setNote(`Added ${code}`);
      return us.map((u) => (u.key === k ? { ...u, barcodes: [...u.barcodes, code] } : u));
    });
    setCodeDraft((c) => ({ ...c, [k]: "" }));
  }, []);
  useWedgeScanner(useCallback((code: string) => addCode(scanInto, code), [addCode, scanInto]));

  const ladder = [...units].filter((u) => u.factor > 1).sort((a, b) => b.factor - a.factor).map((u) => `1 ${u.name || "pack"} = ${u.factor} ${baseUnit}`);

  return (
    <ActionForm action={saveProductAction} onSuccessHref="/products/{id}" className="space-y-6">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <input type="hidden" name="units" value={JSON.stringify(units.map(({ key: _k, ...u }) => u))} />

      <Panel title="What it is" eyebrow="Product" icon={<Package />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Brand / shelf name"><Input name="name" defaultValue={d.name} required autoFocus={!d.id} placeholder="Panadol" /></Field>
          <Field label="Generic name"><Input name="genericName" defaultValue={d.genericName ?? ""} placeholder="Paracetamol" /></Field>
          <Field label="Strength"><Input name="strength" defaultValue={d.strength ?? ""} placeholder="500 mg" /></Field>
          <Field label="Form">
            <Input name="form" list="forms" defaultValue={d.form ?? ""} placeholder="tablet" />
            <datalist id="forms">{FORMS.map((f) => <option key={f} value={f} />)}</datalist>
          </Field>
          <Field label="Manufacturer"><Input name="manufacturer" defaultValue={d.manufacturer ?? ""} /></Field>
          <Field label="Schedule" hint="Controls who can sell it and whether it goes in the register">
            <Select name="schedule" defaultValue={d.schedule ?? "otc"}>
              {Object.entries(scheduleLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select name="categoryId" defaultValue={d.categoryId ?? ""}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="…or a new category"><Input name="newCategory" placeholder="e.g. Antifungals" /></Field>
          <Field label="Shelf location"><Input name="shelf" defaultValue={d.shelf ?? ""} placeholder="A3" /></Field>
        </div>
      </Panel>

      <Panel title="Pack sizes, prices and barcodes" eyebrow="Selling" icon={<Layers />}
        actions={<Button type="button" variant="secondary" size="sm" onClick={() => setUnits((us) => [...us, { key: key(), name: "", factor: 10, price: "", sellable: true, isDefault: false, barcodes: [] }])}><Plus className="h-3.5 w-3.5" />Add pack size</Button>}>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Field label="Smallest unit (stock is counted in this)" hint="tablet, capsule, bottle, tube…">
            <Input name="baseUnit" value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)} required />
          </Field>
          <div className="sm:col-span-2 self-end text-sm text-muted">
            <span className="text-subtle">Conversion: </span>{ladder.length ? ladder.join(" · ") : `sold by the ${baseUnit || "unit"} only`}
          </div>
        </div>
        <div className="space-y-3">
          {units.map((u) => (
            <div key={u.key} className={cx("rounded-md border p-4", scanInto === u.key ? "border-accent/40 bg-accent/5" : "border-line bg-surface")}>
              <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto]">
                <Field label="Pack name"><Input value={u.name} onChange={(e) => patch(u.key, { name: e.target.value })} placeholder="box, strip, tablet" required /></Field>
                <Field label={`${baseUnit || "units"} per pack`}><Input type="number" min={1} value={u.factor} onChange={(e) => patch(u.key, { factor: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label="Selling price">
                  <Input inputMode="decimal" value={u.price} onChange={(e) => patch(u.key, { price: e.target.value })} placeholder="0.00" disabled={!canPrice && !!u.id} />
                </Field>
                <IconButton type="button" label="Remove pack size" disabled={units.length === 1} onClick={() => setUnits((us) => {
                  const rest = us.filter((x) => x.key !== u.key);
                  return u.isDefault && rest.length ? rest.map((x, i) => (i === 0 ? { ...x, isDefault: true } : x)) : rest;
                })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-fg">
                  <input type="radio" name="__default" checked={u.isDefault} onChange={() => patch(u.key, { isDefault: true })} className="h-4 w-4 accent-[var(--accent)]" />
                  Default for scan and search
                </label>
                <Check label="Sold at the till" checked={u.sellable} onChange={(e) => patch(u.key, { sellable: e.target.checked })} />
                <button type="button" onClick={() => setScanInto(u.key)} className={cx("inline-flex items-center gap-1.5 text-xs font-medium", scanInto === u.key ? "text-accent" : "text-muted hover:text-fg")}>
                  <ScanLine className="h-3.5 w-3.5" aria-hidden />{scanInto === u.key ? "Scanner adds barcodes here" : "Scan barcodes into this pack"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Barcode className="h-4 w-4 text-subtle" aria-hidden />
                {u.barcodes.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded border border-line bg-surface-2 py-1 pl-2 pr-1 font-mono text-xs text-fg">
                    {c}
                    <button type="button" aria-label={`Remove barcode ${c}`} onClick={() => patch(u.key, { barcodes: u.barcodes.filter((x) => x !== c) })} className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg"><X className="h-3 w-3" /></button>
                  </span>
                ))}
                <Input value={codeDraft[u.key] ?? ""} onChange={(e) => setCodeDraft((c) => ({ ...c, [u.key]: e.target.value }))} data-scan-passthrough=""
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCode(u.key, codeDraft[u.key] ?? ""); } }}
                  onFocus={() => setScanInto(u.key)} placeholder="Type or scan, then Enter" className="h-9 w-56 font-mono text-xs" aria-label={`Barcode for ${u.name || "pack"}`} />
                <CameraScanner onCode={(c) => addCode(u.key, c)} label="Camera" className="inline-flex h-9 items-center gap-2 rounded border border-line bg-surface-2 px-3 text-xs font-medium text-fg hover:bg-surface-3" />
              </div>
            </div>
          ))}
        </div>
        {note && <p className="mt-3 text-xs text-muted" role="status">{note}</p>}
        {!canPrice && <p className="mt-3 text-xs text-subtle">Only managers can change selling prices.</p>}
      </Panel>

      <Panel title="Stock, tax and ordering" eyebrow="Settings" icon={<Tag />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={`Reorder when below (${baseUnit || "units"})`} hint="0 = use sales speed only"><Input name="reorderLevel" type="number" min={0} defaultValue={d.reorderLevel ?? 0} /></Field>
          <Field label={`Usual order quantity (${baseUnit || "units"})`} hint="0 = suggest from sales"><Input name="reorderQty" type="number" min={0} defaultValue={d.reorderQty ?? 0} /></Field>
          <Field label="Preferred supplier">
            <Select name="preferredSupplierId" defaultValue={d.preferredSupplierId ?? ""}>
              <option value="">None</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Tax rate (%)" hint={`Leave empty for the pharmacy default (${defaultTaxPercent}%). 0 for zero-rated medicines.`}>
            <Input name="taxPercent" inputMode="decimal" defaultValue={d.taxBp == null ? "" : String(d.taxBp / 100)} />
          </Field>
          <div className="flex flex-col justify-end gap-3 pb-1">
            <Check name="favorite" defaultChecked={d.favorite} label="Quick key on the till" />
            {d.id && <Check name="active" defaultChecked={d.active ?? true} label={<>Active <Badge tone="gray">untick to hide from the till</Badge></>} />}
          </div>
        </div>
      </Panel>

      <div className="flex justify-end"><Submit size="lg">{d.id ? "Save changes" : "Add product"}</Submit></div>
    </ActionForm>
  );
}
