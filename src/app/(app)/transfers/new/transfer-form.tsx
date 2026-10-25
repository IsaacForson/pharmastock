"use client";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { Field, IconButton, Input, Select, Textarea } from "@/components/ui";
import { sendTransferAction } from "../actions";

export type StockItem = {
  id: string; label: string; baseUnit: string; onHand: number; onHandText: string;
  units: { name: string; factor: number }[]; batches: { id: string; batchNo: string; expiry: string | null; qty: number }[];
};
type Line = { key: number; productId: string; batchId: string; qty: string; factor: number };

export function TransferForm({ branches, items, preselect }: { branches: { id: string; name: string }[]; items: StockItem[]; preselect: { productId: string; batchId: string } | null }) {
  const [lines, setLines] = useState<Line[]>(preselect ? [{ key: 0, productId: preselect.productId, batchId: preselect.batchId, qty: "", factor: 1 }] : []);
  const [pick, setPick] = useState("");
  const byId = new Map(items.map((i) => [i.id, i]));
  const add = () => {
    const it = items.find((i) => i.label.toLowerCase() === pick.trim().toLowerCase());
    if (!it) return;
    setLines((l) => [...l, { key: Date.now(), productId: it.id, batchId: "", qty: "", factor: 1 }]);
    setPick("");
  };
  const set = (key: number, p: Partial<Line>) => setLines((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const payload = lines.map((l) => ({ productId: l.productId, batchId: l.batchId || null, qty: Math.round(Number(l.qty) * l.factor) })).filter((l) => l.qty > 0);

  return (
    <ActionForm action={sendTransferAction} onSuccessHref="/transfers/{id}" className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Send to">
          <Select name="toBranchId" required defaultValue={branches.length === 1 ? branches[0].id : ""}>
            {branches.length > 1 && <option value="" disabled>Choose a branch</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)"><Textarea name="notes" rows={1} placeholder="e.g. For weekend cover" /></Field>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add a product" className="min-w-0 flex-1">
          <Input list="transfer-products" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Type a product name"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          <datalist id="transfer-products">{items.map((i) => <option key={i.id} value={i.label}>{i.onHandText} in stock</option>)}</datalist>
        </Field>
        <button type="button" onClick={add} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3"><Plus className="h-4 w-4" aria-hidden /> Add</button>
      </div>

      <div className="space-y-2">
        {!lines.length && <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No items yet. Add the products you&apos;re sending.</p>}
        {lines.map((l) => {
          const it = byId.get(l.productId);
          if (!it) return null;
          const avail = l.batchId ? it.batches.find((b) => b.id === l.batchId)?.qty ?? 0 : it.onHand;
          const over = Number(l.qty) * l.factor > avail;
          return (
            <div key={l.key} className="grid items-end gap-3 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_7rem_9rem_auto]">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg">{it.label}</div>
                <div className="text-xs text-muted">{it.onHandText} sellable here</div>
              </div>
              <Field label="Batch">
                <Select value={l.batchId} onChange={(e) => set(l.key, { batchId: e.target.value })}>
                  <option value="">Earliest expiry first (FEFO)</option>
                  {it.batches.map((b) => <option key={b.id} value={b.id}>{b.batchNo || "No batch no."} · {b.expiry ?? "no expiry"} · {b.qty} {it.baseUnit}</option>)}
                </Select>
              </Field>
              <Field label="Quantity"><Input type="number" min={1} step={1} inputMode="numeric" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} aria-invalid={over} className={over ? "border-bad" : ""} /></Field>
              <Field label="In">
                <Select value={l.factor} onChange={(e) => set(l.key, { factor: Number(e.target.value) })}>
                  <option value={1}>{it.baseUnit}</option>
                  {it.units.map((u) => <option key={u.factor} value={u.factor}>{u.name} ({u.factor})</option>)}
                </Select>
              </Field>
              <IconButton type="button" label="Remove" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}><Trash2 className="h-4 w-4" /></IconButton>
              {over && <p className="text-xs text-bad sm:col-span-5">Only {avail} {it.baseUnit} available.</p>}
            </div>
          );
        })}
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <div className="flex justify-end"><Submit size="lg" disabled={!payload.length}>Send stock</Submit></div>
    </ActionForm>
  );
}
