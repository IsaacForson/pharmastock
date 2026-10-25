import { ActionForm, Submit } from "@/components/form";
import { Check, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import type { Customer } from "@/db/schema";
import { toMajor } from "@/lib/format";
import { saveCustomerAction } from "./actions";

export function CustomerForm({ c, payers, canLimit }: { c?: Customer; payers: { id: string; name: string }[]; canLimit: boolean }) {
  return (
    <ActionForm action={saveCustomerAction} onSuccessHref="/customers/{id}" className="space-y-4">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Panel title="Contact" eyebrow="Who">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input name="name" required defaultValue={c?.name} autoFocus /></Field>
          <Field label="Phone" hint="Saved in international format"><Input name="phone" inputMode="tel" defaultValue={c?.phone ?? ""} /></Field>
          <Field label="Email"><Input name="email" type="email" defaultValue={c?.email ?? ""} /></Field>
          <Field label="Date of birth"><Input name="dob" type="date" defaultValue={c?.dob ?? ""} /></Field>
          <Field label="Sex"><Select name="sex" defaultValue={c?.sex ?? ""}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></Select></Field>
          <Field label="Address" hint="Used for deliveries"><Input name="address" defaultValue={c?.address ?? ""} /></Field>
        </div>
      </Panel>
      <Panel title="Health notes" eyebrow="Private" >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Allergies" hint="Shown at the till. Stored encrypted."><Textarea name="allergies" defaultValue={c?.allergies ?? ""} /></Field>
          <Field label="Notes" hint="Stored encrypted."><Textarea name="notes" defaultValue={c?.notes ?? ""} /></Field>
        </div>
      </Panel>
      <Panel title="Account and insurance" eyebrow="Money">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Credit limit" hint={canLimit ? "0 = no credit" : "Set by a manager"}><Input name="creditLimit" inputMode="decimal" defaultValue={toMajor(c?.creditLimitMinor)} disabled={!canLimit} /></Field>
          <Field label="Insurer / HMO"><Select name="payerId" defaultValue={c?.payerId ?? ""}><option value="">None</option>{payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Member no."><Input name="memberNo" defaultValue={c?.memberNo ?? ""} /></Field>
        </div>
      </Panel>
      <Panel title="Messages" eyebrow="Consent">
        <div className="grid gap-4 sm:grid-cols-3">
          <Check name="consent" label="Agrees to reminders and receipts" defaultChecked={c?.messagingConsent} />
          <Field label="How consent was given"><Select name="consentMethod" defaultValue={c?.consentMethod ?? "verbal"}><option value="verbal">Told us at the counter</option><option value="whatsapp">By WhatsApp</option><option value="form">Signed form</option></Select></Field>
          <Field label="Send by"><Select name="preferredChannel" defaultValue={c?.preferredChannel ?? "whatsapp"}><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></Select></Field>
          <Check name="optedOut" label="Opted out of all messages" defaultChecked={!!c?.optedOutAt} />
        </div>
      </Panel>
      <div className="flex justify-end"><Submit size="lg">{c ? "Save changes" : "Add customer"}</Submit></div>
    </ActionForm>
  );
}
