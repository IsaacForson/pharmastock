import { BellRing, Bike, Gift, MessageCircle, Percent } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { A, Badge, Callout, Check, Field, Input, Panel } from "@/components/ui";
import { requireCtx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { COUNTRIES } from "@/lib/countries";
import { money, toMajor } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { saveRulesAction } from "../actions";
import { bpToPercent } from "../rules";

export const metadata = { title: "Sales & stock rules" };

export default async function RulesPage() {
  const ctx = await requireCtx("settings.manage");
  const t = ctx.tenant;
  const rules = rulesFor(t.country);
  const owner = ctx.user.role === "owner" ? ctx.user.phone : null;
  return (
    <ActionForm action={saveRulesAction} className="space-y-6">
      <Panel title="Tax" eyebrow={rules.taxName} icon={<Percent />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default tax rate (%)" hint={`Suggested standard rate for ${COUNTRIES[t.country]?.name ?? "your country"}: ${bpToPercent(rules.standardTaxBp)}%. Many medicines are zero-rated — set those per product. Confirm rates with your accountant.`}>
            <Input name="defaultTax" inputMode="decimal" defaultValue={bpToPercent(t.defaultTaxBp)} className="tabular-nums" />
          </Field>
          <div className="flex items-end">
            <div className="w-full rounded border border-line bg-surface px-4 py-3">
              <Check name="pricesIncludeTax" defaultChecked={t.pricesIncludeTax} label={<span>Shelf prices already include tax <span className="text-muted">(normal for retail)</span></span>} />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Stock alerts & reorder" eyebrow="Used by the nightly check" icon={<BellRing />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expiry alerts (days before expiry)" hint="Separate with commas. Alerts suggest discounting, transferring or returning the batch in time.">
            <Input name="expiryAlertDays" defaultValue={t.expiryAlertDays.join(", ")} className="tabular-nums" />
          </Field>
          <Field label="Reorder cover (days)" hint="How many days of sales a suggested order should cover, including supplier lead time.">
            <Input name="reorderCoverDays" type="number" min={3} max={180} defaultValue={t.reorderCoverDays} className="tabular-nums" />
          </Field>
        </div>
      </Panel>

      <Panel title="Owner summary on WhatsApp" eyebrow="Daily" icon={<MessageCircle />}
        actions={!hasFeature(t, "owner_summary") && <Badge tone="purple">Pro plan</Badge>}>
        <p className="mb-4 text-sm text-muted">Every evening: today&apos;s sales and margin, cash vs mobile money, near-expiry value and what to reorder.</p>
        <div className="mb-4 rounded border border-line bg-surface px-4 py-3">
          <Check name="ownerSummaryEnabled" defaultChecked={t.ownerSummaryEnabled} label="Send the daily summary" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send at"><Input name="ownerSummaryTime" type="time" defaultValue={t.ownerSummaryTime} required /></Field>
          <Field label="WhatsApp number" hint="Leave empty to use the owner's phone"><Input name="ownerSummaryTo" type="tel" defaultValue={t.ownerSummaryTo ?? ""} placeholder={owner ?? ""} /></Field>
        </div>
        {!hasFeature(t, "owner_summary") && <p className="mt-3 text-xs text-subtle">The WhatsApp summary is part of Pro and Chain. <A href="/settings/subscription">See plans</A>.</p>}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Loyalty" eyebrow="Points on every sale" icon={<Gift />}>
          <div className="space-y-4">
            <div className="rounded border border-line bg-surface px-4 py-3">
              <Check name="loyaltyEnabled" defaultChecked={t.loyaltyEnabled} label="Customers earn points" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Points per 1 ${t.currency} spent`}><Input name="loyaltyEarnPerMajor" type="number" min={0} max={1000} defaultValue={t.loyaltyEarnPerMajor} className="tabular-nums" /></Field>
              <Field label={`1 point is worth (${t.currency})`}><Input name="loyaltyPointValue" inputMode="decimal" defaultValue={toMajor(t.loyaltyPointValueMinor)} className="tabular-nums" /></Field>
            </div>
            <p className="text-xs text-subtle">Example: a {money(10000, t.currency)} sale earns {t.loyaltyEarnPerMajor * 100} points, worth {money(t.loyaltyEarnPerMajor * 100 * t.loyaltyPointValueMinor, t.currency)} off a later purchase.</p>
          </div>
        </Panel>
        <Panel title="Home delivery" eyebrow="Default fee" icon={<Bike />}>
          <Field label={`Delivery fee (${t.currency})`} hint="Added to delivery orders; staff can change it per order.">
            <Input name="deliveryFee" inputMode="decimal" defaultValue={toMajor(t.deliveryFeeMinor)} className="tabular-nums" />
          </Field>
        </Panel>
      </div>

      {ctx.access !== "full" && <Callout tone="yellow">This account is read-only, so changes can&apos;t be saved.</Callout>}
      <div className="flex justify-end"><Submit size="lg">Save rules</Submit></div>
    </ActionForm>
  );
}
