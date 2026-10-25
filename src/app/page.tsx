import { ArrowRight, BellRing, Check, ScanBarcode, Smartphone, Upload, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, LinkButton, type Tone } from "@/components/ui";
import { CHAIN_MIN_BRANCHES, PLANS, TRIAL_DAYS, type PlanKey } from "@/lib/plans";
import { planLimitsLine } from "./(app)/settings/subscription/pricing";
import { Price, PriceCurrencySwitcher } from "./pricing/price";
import { CtaBand, Eyebrow, SitePage } from "./pricing/site";

export const metadata: Metadata = {
  title: { absolute: "PharmaStock — Stop throwing away expired medicine" },
  description: "Pharmacy POS and inventory for Ghana, Nigeria and Kenya: batch and expiry tracking, alerts 90 days early, FEFO at the counter, reorder lists, a WhatsApp owner summary and an offline till. Free data export.",
};

const TRUST = ["MTN MoMo", "M-Pesa", "Paystack card", "WhatsApp & SMS", "USB & phone-camera scanners", "Thermal receipts", "Works offline"];

const STEPS = [
  { icon: Smartphone, title: "Start your trial", body: `${TRIAL_DAYS} days, every feature on, no card. Runs on the phones, tablets and laptops you already have.` },
  { icon: Upload, title: "Load your stock", body: "Import your product list or a supplier price list, then scan barcodes with a USB scanner or your phone camera. Or let our setup team do it." },
  { icon: ScanBarcode, title: "Sell from the till", body: "Scan, sell in packs or loose tablets, take cash, MoMo, M-Pesa or card. The oldest-expiring batch is picked for you." },
  { icon: BellRing, title: "Let it watch your shelves", body: "Expiry alerts 90, 60 and 30 days out, a reorder list from real sales, and your day on WhatsApp every evening." },
];

const COMPARE: [string, string, string][] = [
  ["Expiry", "Alerts 90 days early with what to do: discount, transfer or return", "Found during a shelf check, often too late"],
  ["Batches", "Every delivery recorded by batch, FEFO picked at the till", "One stock number per product"],
  ["Stock-outs", "Reorder list from sales velocity for your top sellers", "Guesswork or a notebook"],
  ["Supplier returns", "Returns calendar: what can still go back, to whom, by when", "Missed return windows"],
  ["Internet down", "Till keeps selling, syncs later", "Sales stop or go on paper"],
  ["Controlled drugs", "Register with running balance, ready for inspection", "Separate paper book"],
  ["Price", "Published monthly price in your currency", "One-off project fee, no updates"],
  ["Your data", "Full export, always free", "Locked in, or charged to get it out"],
];

const FEATURES: [string, string, string][] = [
  ["Expiry alerts 90 days early", "Every batch carries its expiry date. At 90, 60 and 30 days you get the value at risk and what to do: discount it, move it to a branch that sells it faster, or send it back while the supplier still accepts it.", "90 · 60 · 30 d"],
  ["FEFO at the counter", "Scan a product and the till takes stock from the batch that expires first. Enforced, not just reported: expired or recalled batches cannot be sold.", "first expiry, first out"],
  ["Never run out of your top 50", "Reorder points per item and a suggested order from real sales velocity and seasonality. Send it to your supplier on WhatsApp; they confirm from a link.", "reorder list"],
  ["Your day on WhatsApp", "Every evening: sales and margin, cash against mobile money, credit given, near-expiry value and what to reorder, even when you are not in the shop.", "21:30 summary"],
  ["Returns calendar", "Knows each supplier's return rules and tells you which batches can still go back, to whom and by when, then tracks the credit note.", "return by date"],
  ["Prescriptions and the controlled register", "Prescription records with refill reminders, pharmacist sign-off for P and POM items, and a controlled-drug register with a running balance in the format inspectors expect.", "append-only"],
  ["Works when the internet does not", "The till keeps selling offline, prints 80mm receipts or sends them on WhatsApp, and syncs every sale exactly once when the connection returns.", "offline till"],
];

const LEDGER: { batch: string; item: string; exp: string; value: string; action: string; tone: Tone }[] = [
  { batch: "CT1188", item: "Coartem 20/120", exp: "28 d", value: "GH₵ 412.00", action: "Transfer to Osu", tone: "red" },
  { batch: "AMX2207", item: "Amoxicillin 500 mg", exp: "62 d", value: "GH₵ 288.50", action: "Return to Ernest Chemists by 14 Dec", tone: "yellow" },
  { batch: "MTF0440", item: "Metformin 500 mg", exp: "75 d", value: "GH₵ 96.00", action: "Discount 15%", tone: "yellow" },
  { batch: "OR551", item: "ORS sachets", exp: "88 d", value: "GH₵ 62.50", action: "Sells 40/week, clears in time", tone: "green" },
];

export default function LandingPage() {
  return (
    <SitePage>
      {/* Hero: claim on the left, a live-looking expiry ledger on the right */}
      <section className="border-b border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-20">
          <div>
            <Eyebrow>Pharmacy POS · Ghana · Nigeria · Kenya</Eyebrow>
            <h1 className="mt-5 text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.025em] text-fg sm:text-6xl">
              Stop throwing away <span className="underline decoration-accent decoration-[6px] underline-offset-[10px]">expired medicine.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Alerts 90 days before stock expires, a reorder list for your top sellers, and a till that keeps selling when the internet doesn&apos;t.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup" size="lg">Start your {TRIAL_DAYS}-day free trial <ArrowRight className="h-4 w-4" aria-hidden /></LinkButton>
              <LinkButton href="/pricing" size="lg" variant="secondary">See pricing</LinkButton>
            </div>
            <p className="mt-4 font-mono text-[12px] text-subtle">No card · your real stock · free data export, always</p>
          </div>

          <figure className="sheet overflow-hidden" aria-label="Example expiry ledger">
            <figcaption className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
              <span className="text-[13px] font-semibold text-fg">Expiring this quarter</span>
              <span className="font-mono text-[11px] text-subtle">Liberation Road · 25 Oct</span>
            </figcaption>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2 font-semibold">Batch</th><th className="py-2 font-semibold">Item</th><th className="py-2 text-right font-semibold">Left</th><th className="px-4 py-2 text-right font-semibold">At cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {LEDGER.map((r) => (
                  <tr key={r.batch}>
                    <td className="px-4 py-2.5 align-top font-mono text-[12px] text-muted">{r.batch}</td>
                    <td className="py-2.5 pr-2 align-top"><div className="font-medium text-fg">{r.item}</div><div className="text-[12px] text-subtle">{r.action}</div></td>
                    <td className="py-2.5 text-right align-top"><Badge tone={r.tone}>{r.exp}</Badge></td>
                    <td className="px-4 py-2.5 text-right align-top font-mono text-fg">{r.value}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line-strong">
                  <td colSpan={3} className="px-4 py-2.5 text-[12px] font-semibold text-fg">Value you can still save</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-accent">GH₵ 859.00</td>
                </tr>
              </tfoot>
            </table>
          </figure>
        </div>
      </section>

      {/* Works-with line */}
      <section aria-label="Works with" className="border-b border-line bg-surface">
        <p className="mx-auto max-w-6xl px-4 py-4 font-mono text-[12px] leading-relaxed text-muted sm:px-6">
          <span className="text-subtle">Works with · </span>{TRUST.join(" · ")}
        </p>
      </section>

      {/* Features as a numbered register, not cards */}
      <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <SectionHead id="features-title" eyebrow="What it does" title="Plug the two leaks: expired stock and stock-outs.">
          Generic POS apps record sales. PharmaStock manages batches, expiry, FEFO and reorders, the things that quietly cost a pharmacy money.
        </SectionHead>
        <ol className="mt-10 border-t border-line-strong">
          {FEATURES.map(([title, body, tag], i) => (
            <li key={title} className="grid gap-x-6 gap-y-1 border-b border-line py-5 md:grid-cols-[3rem_16rem_1fr_9rem]">
              <span className="font-mono text-[13px] text-subtle">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-semibold text-fg">{title}</h3>
              <p className="text-[14px] leading-relaxed text-muted">{body}</p>
              <span className="font-mono text-[12px] text-accent md:text-right">{tag}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* How it works: four ruled columns */}
      <section id="how" aria-labelledby="how-title" className="scroll-mt-20 border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <SectionHead id="how-title" eyebrow="How it works" title="Notebook on Monday. PharmaStock by Friday.">
            No server in the back room and no long contract. Load your stock, scan your shelves and start selling.
          </SectionHead>
          <ol className="mt-10 grid border-l border-line md:grid-cols-4">
            {STEPS.map((st, i) => (
              <li key={st.title} className="border-b border-r border-t border-line p-5 md:border-b-0">
                <div className="flex items-center justify-between text-accent">
                  <st.icon className="h-5 w-5" aria-hidden />
                  <span className="font-mono text-[12px] text-subtle">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold text-fg">{st.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{st.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Comparison */}
      <section aria-labelledby="compare-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <SectionHead id="compare-title" eyebrow="Why pharmacies switch" title="More than a billing app.">
          Notebooks, spreadsheets and generic POS apps don&apos;t know about batches or expiry dates. That&apos;s where the money goes.
        </SectionHead>
        <div className="sheet mt-10 overflow-x-auto">
          <table className="min-w-full text-left text-[14px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[12px]">
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Feature</span></th>
                <th scope="col" className="border-x border-line px-4 py-2.5 font-semibold text-accent">PharmaStock</th>
                <th scope="col" className="px-4 py-2.5 font-semibold text-muted">Paper, Excel or a generic POS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COMPARE.map(([k, us, them]) => (
                <tr key={k}>
                  <th scope="row" className="whitespace-nowrap px-4 py-3 font-semibold text-fg">{k}</th>
                  <td className="border-x border-line px-4 py-3 text-fg"><span className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden />{us}</span></td>
                  <td className="px-4 py-3 text-muted"><span className="flex gap-2"><X className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />{them}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing as a price list */}
      <section aria-labelledby="price-title" className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <SectionHead id="price-title" eyebrow="Pricing" title={<>From <Price of={{ plan: "starter" }} /> a month. Published, in your currency.</>}>
          {TRIAL_DAYS}-day free trial with your real stock, no card. Pay monthly, or yearly and get 2 months free.
          <span className="mt-4 block"><PriceCurrencySwitcher /></span>
        </SectionHead>
        <div className="sheet mt-10 divide-y divide-line">
          {(Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][]).map(([key, p]) => (
            <Link key={key} href={`/pricing#${key}`} className="grid items-baseline gap-x-6 gap-y-1 px-5 py-4 hover:bg-surface-2 sm:grid-cols-[10rem_1fr_auto]">
              <span className="flex items-center gap-2 font-semibold text-fg">{p.name}{key === "pro" && <Badge tone="purple">Most chosen</Badge>}</span>
              <span className="text-[14px] text-muted">{planLimitsLine(key)}</span>
              <span className="font-mono text-[18px] font-semibold text-fg"><Price of={{ plan: key }} /><span className="text-[13px] font-normal text-muted"> /month{key === "chain" ? " per branch" : ""}</span></span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-subtle">Chain is billed for at least {CHAIN_MIN_BRANCHES} branches. One-time setup service available: we load your stock, label your shelves and train your staff.</p>
      </section>

      <CtaBand title="Know what's expiring before it does." body={`Start free for ${TRIAL_DAYS} days, every feature on. Cancel any time and take all your data with you.`} />
    </SitePage>
  );
}

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-fg sm:text-4xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted">{children}</p>
    </div>
  );
}
