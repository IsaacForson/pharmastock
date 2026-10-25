import { Field, Input, Select, Textarea } from "@/components/ui";
import type { recalls } from "@/db/schema";
import { COUNTRIES } from "@/lib/countries";

/** Shared fields for creating and editing a recall notice. */
export function RecallFields({ r }: { r?: typeof recalls.$inferSelect }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Product (brand) name"><Input name="productName" defaultValue={r?.productName} required placeholder="e.g. Coartem 20/120" /></Field>
      <Field label="Generic name" hint="Matches pharmacies that stock another brand of it"><Input name="genericName" defaultValue={r?.genericName ?? ""} placeholder="e.g. Artemether/Lumefantrine" /></Field>
      <Field label="Manufacturer"><Input name="manufacturer" defaultValue={r?.manufacturer ?? ""} /></Field>
      <Field label="Country" hint="Leave as all countries when the notice is international">
        <Select name="country" defaultValue={r?.country ?? ""}>
          <option value="">All countries</option>
          {Object.entries(COUNTRIES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Batch numbers" hint="Separate with commas or new lines. Leave empty when every batch is recalled." className="sm:col-span-2">
        <Textarea name="batchNos" defaultValue={r?.batchNos.join(", ") ?? ""} className="font-mono" placeholder="AB1234, AB1235" />
      </Field>
      <Field label="Reason" className="sm:col-span-2"><Textarea name="reason" defaultValue={r?.reason} required placeholder="e.g. Out-of-specification dissolution results" /></Field>
      <Field label="Source" hint="Regulator notice reference or link"><Input name="source" defaultValue={r?.source ?? ""} placeholder="FDA Ghana notice 2026/041" /></Field>
      <Field label="Published on"><Input name="publishedOn" type="date" defaultValue={r?.publishedOn ?? new Date().toISOString().slice(0, 10)} required /></Field>
    </div>
  );
}
