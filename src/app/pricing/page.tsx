import { ArrowRight, Check, ChevronDown, GraduationCap, Minus, Rocket, ScanBarcode, Upload } from "lucide-react";
import type { Metadata } from "next";
import { FEATURE_LABELS, planLimitsLine, SETUP_TIERS } from "@/app/(app)/settings/subscription/pricing";
import { Badge, cx, IconTile, LinkButton } from "@/components/ui";
import { CHAIN_MIN_BRANCHES, GRACE_DAYS, PLANS, TRIAL_DAYS, type Feature, type PlanKey } from "@/lib/plans";
import { Price, PriceCurrencySwitcher } from "./price";
import { CtaBand, Eyebrow, SitePage } from "./site";

export const metadata: Metadata = {
  title: "Pricing",
  description: `Starter, Pro and Chain plans for pharmacies and drug shops, priced in your local currency. ${TRIAL_DAYS}-day free trial, no card. Free data export, always.`,
};

const BLURB: Record<PlanKey, string> = {
  starter: "For a drug shop or small pharmacy that wants expiry and stock under control.",
  pro: "For a pharmacy with a pharmacist on duty, prescriptions and a controlled-drug register.",
  chain: `For 2 or more branches that share stock, purchasing and reports. Minimum ${CHAIN_MIN_BRANCHES} branches billed.`,
};

const FAQ: [string, string][] = [
  ["Do I need a card to start?", `No. Every pharmacy starts with a ${TRIAL_DAYS}-day free trial with every feature on, using your real stock. You only add payment when you choose a plan.`],
  ["How does Chain pricing work?", `Chain is priced per branch per month, with a minimum of ${CHAIN_MIN_BRANCHES} branches. Open a fourth branch and your next bill covers four.`],
  ["How does annual billing work?", "Pay for 10 months and get 12 — two months free on any plan."],
  ["What happens if we stop paying?", `Nothing is deleted and you're never locked out. After a ${GRACE_DAYS}-day grace period the account becomes read-only: you can still look up every sale, print your registers and export all your data.`],
  ["Can you load our stock for us?", "Yes. The one-time setup service imports your product list from your spreadsheet or supplier price lists, can include a barcode labelling session, and can include training for your counter staff."],
  ["Does the till work without internet?", "Yes. Sales keep going when the connection drops and sync when it comes back. A sale is never blocked because the internet is down."],
  ["Is data export extra?", "Never. Full export of every record, in CSV and JSON, is free on every plan — even on a read-only account."],
  ["Which payment methods do you accept?", "Card and mobile money through Paystack, in your local currency where Paystack supports it (Ghana cedi, naira, Kenyan shilling and more), otherwise in US dollars."],
];

const plans = Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][];
const SETUP_ICONS = { basic: <Upload />, standard: <ScanBarcode />, full: <GraduationCap /> } as const;

export default function PricingPage() {
  return (
    <SitePage>
      {/* Billing period toggle is CSS-only (radio + :has), so it works before/without JS. */}
      <div className="group/bill">
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-14 sm:px-6">
            <Eyebrow>Pricing</Eyebrow>
            <h1 className="mt-5 max-w-3xl text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.025em] text-fg sm:text-6xl">
              Pays for itself in <span className="underline decoration-accent decoration-[6px] underline-offset-[10px]">saved stock.</span>
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              One clear monthly price per pharmacy, in your currency. No per-sale fees, no add-on fees for alerts, backups or data export.
            </p>

            <fieldset className="mt-8 inline-flex rounded border border-line-strong bg-surface p-0.5">
              <legend className="sr-only">Billing period</legend>
              {[["monthly", "Monthly"], ["annual", "Annual"]].map(([v, label]) => (
                <label key={v} className="relative flex cursor-pointer items-center gap-2 rounded px-5 py-2 text-sm font-medium text-muted transition has-[:checked]:bg-surface-3 has-[:checked]:text-fg has-[:checked]:shadow-[inset_0_0_0_1px_var(--line-strong)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                  <input type="radio" name="billing" id={`bill-${v}`} value={v} defaultChecked={v === "monthly"} className="sr-only" />
                  {label}
                  {v === "annual" && <span className="rounded-md bg-ok/12 px-1.5 py-0.5 text-[10px] font-semibold text-ok">2 months free</span>}
                </label>
              ))}
            </fieldset>
            <div className="mt-4"><PriceCurrencySwitcher /></div>

            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[12px] text-muted">
              {[`${TRIAL_DAYS}-day free trial, no card`, "Free data export, always", "Read-only, never locked out"].map((x) => (
                <li key={x} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-ok" aria-hidden />{x}</li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-label="Plans" className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">
          <div className="sheet grid divide-y divide-line lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {plans.map(([key, p]) => {
              const featured = key === "pro";
              const per = key === "chain" ? " per branch" : "";
              return (
                <article id={key} key={key} className={cx("relative flex scroll-mt-20 flex-col p-7", featured && "border-t-[3px] border-t-accent bg-surface-2")}>
                  <div className="relative flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-fg">{p.name}</h2>
                    {featured && <Badge tone="purple">Most chosen</Badge>}
                  </div>
                  <p className="relative mt-1 text-sm text-muted">{BLURB[key]}</p>

                  <div className="relative mt-6 group-has-[#bill-annual:checked]/bill:hidden">
                    <p><span className="font-mono text-4xl font-semibold tracking-tight text-fg"><Price of={{ plan: key }} /></span><span className="text-muted">/month{per}</span></p>
                    <p className="mt-1.5 text-sm text-subtle">or <Price of={{ plan: key, cycle: "annual" }} />/year{per} (2 months free)</p>
                  </div>
                  <div className="relative mt-6 hidden group-has-[#bill-annual:checked]/bill:block">
                    <p><span className="font-mono text-4xl font-semibold tracking-tight text-fg"><Price of={{ plan: key, cycle: "annual" }} /></span><span className="text-muted">/year{per}</span></p>
                    <p className="mt-1.5 text-sm text-ok">2 months free · <Price of={{ plan: key, cycle: "annual-saving" }} /> saved{per}</p>
                  </div>

                  <p className="relative mt-6 rounded-md border border-line bg-surface px-4 py-3 text-sm font-medium text-fg">{planLimitsLine(key)}</p>

                  <ul className="relative mt-6 flex-1 space-y-2.5 text-sm text-fg">
                    {p.features.map((f) => <li key={f} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-2" aria-hidden />{FEATURE_LABELS[f as Feature]}</li>)}
                  </ul>
                  <LinkButton href={`/signup?plan=${key}`} variant={featured ? "primary" : "secondary"} size="lg" className="relative mt-8 w-full">
                    Start free trial<span className="sr-only"> of {p.name}</span>
                  </LinkButton>
                </article>
              );
            })}
          </div>

          <div className="sheet mt-6 p-6 sm:p-8">
            <div className="flex flex-wrap items-start gap-4">
              <IconTile><Rocket /></IconTile>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-fg">Setup service <span className="ml-1 text-sm font-medium text-accent">one-time</span></h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">Entering your stock is the slowest part of starting. Our team does it with you, so you sell from day one.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {(Object.entries(SETUP_TIERS) as [keyof typeof SETUP_TIERS, (typeof SETUP_TIERS)[keyof typeof SETUP_TIERS]][]).map(([k, t]) => (
                <div key={k} className="rounded-md border border-line bg-surface p-5">
                  <div className="flex items-center justify-between gap-2">
                    <IconTile tone="teal" className="h-9 w-9">{SETUP_ICONS[k]}</IconTile>
                    <span className="text-lg font-semibold tabular-nums text-fg"><Price of={{ setup: k }} /></span>
                  </div>
                  <h3 className="mt-4 font-medium text-fg">{t.name}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{t.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Compare matrix */}
      <section aria-labelledby="matrix" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 id="matrix" className="text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl">Compare plans</h2>
        <div className="sheet mt-8 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-4 text-left"><span className="sr-only">Feature</span></th>
                {plans.map(([k, p]) => <th key={k} scope="col" className={cx("px-5 py-4 text-center font-semibold text-fg", k === "pro" && "bg-accent/10")}>{p.name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <th scope="row" className="whitespace-nowrap px-5 py-3.5 text-left font-normal text-muted">Staff accounts</th>
                {plans.map(([k, p]) => <td key={k} className={cx("px-5 py-3.5 text-center tabular-nums text-fg", k === "pro" && "bg-accent/10")}>{p.users ?? "Unlimited"}</td>)}
              </tr>
              <tr>
                <th scope="row" className="whitespace-nowrap px-5 py-3.5 text-left font-normal text-muted">Branches</th>
                {plans.map(([k, p]) => <td key={k} className={cx("px-5 py-3.5 text-center tabular-nums text-fg", k === "pro" && "bg-accent/10")}>{k === "chain" ? `${CHAIN_MIN_BRANCHES}+` : p.branches}</td>)}
              </tr>
              {(Object.entries(FEATURE_LABELS) as [Feature, string][]).map(([f, label]) => (
                <tr key={f}>
                  <th scope="row" className="whitespace-nowrap px-5 py-3.5 text-left font-normal text-muted">{label}</th>
                  {plans.map(([k, p]) => (
                    <td key={k} className={cx("px-5 py-3.5 text-center", k === "pro" && "bg-accent/10")}>
                      {(p.features as readonly string[]).includes(f)
                        ? <Check className="mx-auto h-4 w-4 text-ok" aria-label="Included" />
                        : <Minus className="mx-auto h-4 w-4 text-subtle" aria-label="Not included" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq" className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <Eyebrow>FAQ</Eyebrow>
          <h2 id="faq" className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl">Questions, answered.</h2>
          <p className="mt-4 text-muted">Anything else? Start a trial and message us from inside the app.</p>
          <LinkButton href="/signup" variant="ghost" className="mt-4 -ml-4">Start free trial <ArrowRight className="h-4 w-4" aria-hidden /></LinkButton>
        </div>
        <div className="space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="sheet group p-0 open:border-line-strong">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium text-fg [&::-webkit-details-marker]:hidden">
                {q}<ChevronDown className="h-4 w-4 shrink-0 text-subtle transition group-open:rotate-180" aria-hidden />
              </summary>
              <p className="px-5 pb-5 leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <CtaBand title={<>Try every feature, <span className="text-brand">free for {TRIAL_DAYS} days.</span></>} body="No card required. Pick a plan when you're ready — or don't, and export everything you entered." />
    </SitePage>
  );
}
