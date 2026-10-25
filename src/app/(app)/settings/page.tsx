import { BadgeCheck, Building2, Globe2, Phone, Printer, Receipt } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { COUNTRIES, CURRENCIES, CURRENCY_NAMES } from "@/lib/countries";
import { updateProfileAction } from "./actions";
import { LogoPicker } from "./logo-picker";

export const metadata = { title: "Settings" };
export default async function PharmacyProfilePage() {
  const ctx = await requireCtx("settings.manage");
  const t = ctx.tenant;
  const rules = rulesFor(t.country);
  const zones = Intl.supportedValuesOf("timeZone").filter((z) => z.startsWith("Africa/") || z.startsWith("Europe/") || z.startsWith("America/") || z === t.timezone);
  return (
    <ActionForm action={updateProfileAction} className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Identity" eyebrow="How customers see you" icon={<Building2 />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Pharmacy name" className="sm:col-span-2"><Input name="name" defaultValue={t.name} required /></Field>
              <div className="sm:col-span-2"><LogoPicker current={t.logoUrl} initial={t.name[0] ?? "P"} /></div>
              <Field label="Letterhead lines" hint="Printed under the pharmacy name on receipts, labels, purchase orders and registers" className="sm:col-span-2">
                <Textarea name="letterhead" defaultValue={t.letterhead ?? ""} placeholder={"Open daily 8am–9pm\nP.O. Box 123"} />
              </Field>
            </div>
          </Panel>
          <Panel title="Contact & registration" eyebrow="Printed on documents" icon={<Phone />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={t.phone ?? ""} /></Field>
              <Field label="Email"><Input name="email" type="email" defaultValue={t.email ?? ""} /></Field>
              <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={t.address ?? ""} /></Field>
              <Field label="Tax ID (TIN)"><Input name="taxId" defaultValue={t.taxId ?? ""} /></Field>
            </div>
          </Panel>
          <Panel title="Licence & superintendent" eyebrow={`Registered with ${rules.regulator}`} icon={<BadgeCheck />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Premises licence number" hint="Printed on receipts and the controlled-drug register"><Input name="licenceNo" defaultValue={t.licenceNo ?? ""} className="font-mono" /></Field>
              <div className="hidden sm:block" />
              <Field label="Superintendent pharmacist"><Input name="superintendent" defaultValue={t.superintendent ?? ""} placeholder="Full name" /></Field>
              <Field label="Registration number"><Input name="superintendentRegNo" defaultValue={t.superintendentRegNo ?? ""} className="font-mono" /></Field>
            </div>
          </Panel>
          <Panel title="Receipts" eyebrow="Bottom of every receipt" icon={<Receipt />}>
            <Field label="Receipt footer" hint="e.g. returns policy or a thank-you line. Keep it short for 80mm paper.">
              <Textarea name="receiptFooter" rows={2} defaultValue={t.receiptFooter ?? ""} placeholder="Thank you! Medicines sold cannot be returned once opened." />
            </Field>
          </Panel>
          <Panel title="Region & money" eyebrow="Locale" icon={<Globe2 />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Country">
                <Select name="country" defaultValue={t.country}>{Object.entries(COUNTRIES).map(([k, c]) => <option key={k} value={k}>{c.name}</option>)}</Select>
              </Field>
              <Field label="Currency" hint={`Defaults to your country's currency. Used for prices, receipts, reports and your subscription. Existing amounts are not converted.`}>
                <Select name="currency" defaultValue={t.currency}>{CURRENCIES.map((c) => <option key={c} value={c}>{c} · {CURRENCY_NAMES[c]}</option>)}</Select>
              </Field>
              <Field label="Timezone">
                <Select name="timezone" defaultValue={t.timezone}>{zones.map((z) => <option key={z}>{z}</option>)}</Select>
              </Field>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Panel title="Letterhead preview" eyebrow="Saved version" icon={<Printer />}>
            {/* A paper-like sheet so the pharmacy sees roughly what prints. */}
            <div className="rounded-xl border border-line bg-surface-2 p-4 shadow-panel">
              <div className="flex items-start gap-3 border-b border-line pb-3">
                {t.logoUrl
                  ? <img src={t.logoUrl} alt="" className="h-11 w-11 rounded-lg object-contain" />
                  : <span className="grid h-11 w-11 place-items-center rounded-lg bg-aurora text-lg font-semibold text-on-accent">{t.name[0]}</span>}
                <div className="min-w-0">
                  <div className="truncate font-semibold tracking-tight text-fg">{t.name}</div>
                  {t.letterhead && <div className="whitespace-pre-line text-[11px] leading-snug text-muted">{t.letterhead}</div>}
                </div>
              </div>
              <div className="space-y-0.5 pt-3 text-[11px] text-muted">
                {[t.address, [t.phone, t.email].filter(Boolean).join(" · "), t.licenceNo && `Licence ${t.licenceNo}`, t.superintendent && `Superintendent: ${t.superintendent}${t.superintendentRegNo ? ` (${t.superintendentRegNo})` : ""}`, t.taxId && `TIN ${t.taxId}`].filter(Boolean).map((l, i) => <div key={i} className="truncate">{l}</div>)}
              </div>
              <div className="mt-4 space-y-1.5" aria-hidden>
                <div className="h-1.5 w-3/4 rounded-full bg-surface-3" />
                <div className="h-1.5 w-full rounded-full bg-surface-3" />
                <div className="h-1.5 w-2/3 rounded-full bg-surface-3" />
              </div>
            </div>
            <p className="mt-3 text-xs text-subtle">Updates after you save. Used on receipts, labels, purchase orders and registers.</p>
          </Panel>
          <div className="flex justify-end"><Submit size="lg" className="w-full xl:w-auto">Save profile</Submit></div>
        </aside>
      </div>
    </ActionForm>
  );
}
