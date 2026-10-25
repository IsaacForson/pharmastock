import { ArrowLeftRight, Coins, RefreshCw, Tags } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { Badge, Field, Input, PageHeader, Panel, Table, Td } from "@/components/ui";
import { adminDb } from "@/db";
import { fxRates } from "@/db/schema";
import { CURRENCIES, CURRENCY_NAMES } from "@/lib/countries";
import { dateTime, money } from "@/lib/format";
import { DEFAULT_PER_USD, PAYSTACK_CURRENCIES } from "@/lib/money";
import { PLANS, type PlanKey } from "@/lib/plans";
import { requireAdmin } from "@/lib/platform-auth";
import { moneyCtx } from "@/lib/platform-metrics";
import { refreshRatesAction, saveRateAction, savePriceBookAction } from "../actions";

export const metadata = { title: "Pricing & currencies" };

const major = (minor: number) => (minor / 100).toFixed(2).replace(/\.00$/, "");

export default async function PricingPage() {
  await requireAdmin("pharmacies.billing");
  const [m, rows] = await Promise.all([moneyCtx("USD"), adminDb().select().from(fxRates)]);
  const stored = new Map(rows.map((r) => [r.currency, r]));
  return (
    <>
      <PageHeader eyebrow="Finance" icon={<Coins />} title="Pricing & currencies"
        subtitle="Pharmacies see and pay their subscription in their own currency. Set local prices here (e.g. by purchasing power); without one, the USD price is converted and rounded." />

      <Panel title="Local subscription prices" eyebrow="Per currency · monthly" icon={<Tags />}>
        <div className="space-y-3">
          {CURRENCIES.map((cur) => {
            const list = m.lists.get(cur)!;
            return (
              <details key={cur} className="group rounded-2xl border border-line bg-surface">
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
                  <span className="w-12 font-mono text-sm font-semibold">{cur}</span>
                  <span className="text-sm text-muted">{CURRENCY_NAMES[cur]}</span>
                  {list.custom ? <Badge tone="purple">custom prices</Badge> : <Badge>converted from USD</Badge>}
                  {!PAYSTACK_CURRENCIES.has(cur) && <Badge tone="yellow">billed in USD</Badge>}
                  <span className="ml-auto text-sm tabular-nums text-muted">
                    {(Object.keys(PLANS) as PlanKey[]).map((p) => `${PLANS[p].name} ${money(list.plans[p], cur)}${p === "chain" ? "/branch" : ""}`).join(" · ")}
                  </span>
                </summary>
                <ActionForm action={savePriceBookAction} className="grid gap-3 border-t border-line p-4 sm:grid-cols-3 [&>*]:mb-0!">
                  <input type="hidden" name="currency" value={cur} />
                  <Field label="Starter / month"><Input name="starter" inputMode="decimal" defaultValue={major(list.plans.starter)} /></Field>
                  <Field label="Pro / month"><Input name="pro" inputMode="decimal" defaultValue={major(list.plans.pro)} /></Field>
                  <Field label="Chain / branch / month" hint="Billed for at least 3 branches"><Input name="chainPerBranch" inputMode="decimal" defaultValue={major(list.plans.chain)} /></Field>
                  <Field label="Setup: basic"><Input name="setupBasic" inputMode="decimal" defaultValue={major(list.setup.basic)} /></Field>
                  <Field label="Setup: standard"><Input name="setupStandard" inputMode="decimal" defaultValue={major(list.setup.standard)} /></Field>
                  <Field label="Setup: full"><Input name="setupFull" inputMode="decimal" defaultValue={major(list.setup.full)} /></Field>
                  <div className="flex items-end gap-2 sm:col-span-3 sm:justify-end">
                    <Submit size="md" className="flex-1">Save {cur} prices</Submit>
                    {list.custom && <button name="reset" value="1" className="h-10 rounded-xl border border-line px-3 text-xs text-muted hover:text-fg">Reset</button>}
                  </div>
                </ActionForm>
              </details>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-subtle">Annual billing is 10 × the monthly price (2 months free). Setup services are one-time: stock list import, barcode labelling session, staff training. Changes apply to new checkouts; existing subscriptions keep their period.</p>
      </Panel>

      <div className="mt-6">
        <Panel title="Exchange rates" eyebrow="Units per 1 USD" icon={<ArrowLeftRight />}
          actions={<ActionForm action={refreshRatesAction} className="space-y-0"><Submit size="sm" variant="secondary"><RefreshCw className="h-3.5 w-3.5" />Refresh now</Submit></ActionForm>}>
          <Table head={["Currency", "Rate", "Source", "Updated", ""]}>
            {CURRENCIES.map((cur) => {
              const r = stored.get(cur);
              return (
                <tr key={cur}>
                  <Td className="font-mono text-sm font-semibold">{cur}</Td>
                  <Td colSpan={1}>
                    <ActionForm action={saveRateAction} className="flex items-center gap-2 space-y-0">
                      <input type="hidden" name="currency" value={cur} />
                      <Input name="perUsd" inputMode="decimal" defaultValue={String(m.rates[cur] ?? DEFAULT_PER_USD[cur])} disabled={cur === "USD"} className="h-8 w-32 text-xs tabular-nums" />
                      {cur !== "USD" && <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="locked" defaultChecked={r?.locked} /> lock</label>}
                      {cur !== "USD" && <Submit size="sm" variant="secondary">Save</Submit>}
                    </ActionForm>
                  </Td>
                  <Td className="text-xs text-muted">{r?.source ?? "built-in default"}</Td>
                  <Td className="text-xs text-muted">{r ? dateTime(r.updatedAt, "UTC") : "—"}</Td>
                  <Td>{r?.locked && <Badge tone="yellow">locked</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-3 text-xs text-subtle">Rates refresh daily from a public feed. Locked rates are never overwritten. Rates are used to convert prices and to total revenue across currencies in Control.</p>
        </Panel>
      </div>
    </>
  );
}
