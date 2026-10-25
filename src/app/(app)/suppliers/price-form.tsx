"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { Field, IconButton, Input, Select } from "@/components/ui";
import type { CatalogItem } from "../purchasing/catalog";
import { itemLabel, ProductSearch } from "../purchasing/product-search";
import { savePriceAction } from "./actions";

/** Add or update one line of a supplier's price list. */
export function PriceForm({ supplierId, catalog }: { supplierId: string; catalog: CatalogItem[] }) {
  const [p, setP] = useState<CatalogItem | null>(null);
  const [unitId, setUnitId] = useState("");
  return (
    <ActionForm action={savePriceAction} resetOnSuccess successMessage="Price saved." className="space-y-3">
      <input type="hidden" name="supplierId" value={supplierId} />
      {p ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="truncate font-medium text-fg">{itemLabel(p)}</span>
          <IconButton type="button" label="Choose another product" onClick={() => setP(null)}><X className="h-4 w-4" /></IconButton>
          <input type="hidden" name="productId" value={p.id} />
        </div>
      ) : (
        <ProductSearch catalog={catalog} onPick={(x, u) => { setP(x); setUnitId(u ?? [...x.units].sort((a, b) => b.factor - a.factor)[0]?.id ?? ""); }} placeholder="Find a product" />
      )}
      {p && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Pack"><Select name="unitId" value={unitId} onChange={(e) => setUnitId(e.target.value)}>{p.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Cost per pack"><Input name="cost" inputMode="decimal" required placeholder="0.00" defaultValue={(() => { const c = p.prices.find((x) => x.supplierId === supplierId && x.unitId === unitId)?.costMinor; return c != null ? (c / 100).toFixed(2) : ""; })()} key={unitId} /></Field>
          <Field label="Supplier's code"><Input name="supplierCode" placeholder="Optional" /></Field>
        </div>
      )}
      {p && <div className="flex justify-end"><Submit size="sm">Save price</Submit></div>}
    </ActionForm>
  );
}
