"use client";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";

/** Medicine rows for a prescription form. Product names come from a datalist so the till can match stock. */
export function RxItems({ products }: { products: string[] }) {
  const [rows, setRows] = useState([0]);
  const [next, setNext] = useState(1);
  return (
    <div className="space-y-3">
      <datalist id="rx-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
      {rows.map((n, i) => (
        <div key={n} className="rounded-2xl border border-line p-4">
          <div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.18em] text-subtle">Medicine {i + 1}</span>
            {rows.length > 1 && <button type="button" aria-label="Remove medicine" onClick={() => setRows((r) => r.filter((x) => x !== n))} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad"><Trash2 className="h-4 w-4" /></button>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="As written"><Input name={`items.${n}.drugName`} required placeholder="e.g. Amoxicillin 500mg caps" /></Field>
            <Field label="Our product" hint="Pick from stock so the till can fill it"><Input name={`items.${n}.product`} list="rx-products" /></Field>
            <Field label="Quantity per fill" hint="In tablets / capsules / bottles"><Input name={`items.${n}.qty`} type="number" min={0} inputMode="numeric" /></Field>
            <Field label="Dose"><Input name={`items.${n}.dose`} placeholder="1 capsule" /></Field>
            <Field label="Frequency"><Input name={`items.${n}.frequency`} placeholder="3 times a day" /></Field>
            <Field label="Duration"><Input name={`items.${n}.duration`} placeholder="7 days" /></Field>
            <Field label="Directions for the label" className="sm:col-span-2 lg:col-span-3"><Input name={`items.${n}.directions`} placeholder="Take one capsule three times a day after meals" /></Field>
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={() => { setRows((r) => [...r, next]); setNext(next + 1); }}><Plus className="h-4 w-4" aria-hidden /> Add medicine</Button>
    </div>
  );
}
