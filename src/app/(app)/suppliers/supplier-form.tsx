import { ActionForm, Submit } from "@/components/form";
import { Check, Field, Input, Panel, Textarea } from "@/components/ui";
import type { suppliers } from "@/db/schema";
import { saveSupplierAction } from "./actions";

/** Create / edit a supplier. Terms drive due dates, reorder lead time and the returns calendar. */
export function SupplierForm({ s }: { s?: typeof suppliers.$inferSelect }) {
  return (
    <ActionForm action={saveSupplierAction} onSuccessHref="/suppliers/{id}" className="space-y-6">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Panel title="Contact" eyebrow="Who you buy from">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier name"><Input name="name" required defaultValue={s?.name} placeholder="e.g. Kama Pharmaceuticals" autoFocus={!s} /></Field>
          <Field label="Contact person"><Input name="contactName" defaultValue={s?.contactName ?? ""} /></Field>
          <Field label="WhatsApp number" hint="Purchase orders are sent here. Local numbers get your country code."><Input name="phone" type="tel" defaultValue={s?.phone ?? ""} placeholder="024 123 4567" /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={s?.email ?? ""} /></Field>
          <Field label="Wholesale licence no."><Input name="licenceNo" defaultValue={s?.licenceNo ?? ""} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={s?.address ?? ""} /></Field>
        </div>
      </Panel>
      <Panel title="Terms" eyebrow="Payment, delivery and returns">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Pay within (days)" hint="0 = pay on delivery"><Input name="paymentTermsDays" type="number" min={0} max={365} defaultValue={s?.paymentTermsDays ?? 30} /></Field>
          <Field label="Delivery lead time (days)" hint="Used by the reorder list"><Input name="leadTimeDays" type="number" min={0} max={180} defaultValue={s?.leadTimeDays ?? 3} /></Field>
          <Field label="Takes returns with at least (days to expiry)"><Input name="returnMinDaysToExpiry" type="number" min={0} max={1095} defaultValue={s?.returnMinDaysToExpiry ?? 90} /></Field>
          <Field label="Returns within (days of delivery)" hint="0 = no limit"><Input name="returnWithinDaysOfDelivery" type="number" min={0} max={1095} defaultValue={s?.returnWithinDaysOfDelivery ?? 0} /></Field>
        </div>
        {s && <div className="mt-4"><input type="hidden" name="active" value="" /><Check name="active" defaultChecked={s.active} label="Active (shown when ordering)" /></div>}
      </Panel>
      <div className="flex justify-end"><Submit size="lg">{s ? "Save supplier" : "Add supplier"}</Submit></div>
    </ActionForm>
  );
}
