import {
  ArrowRight, BellRing, Boxes, CalendarClock, Check, CloudOff, Download, MessageCircle, PackageX, ScanBarcode, ShieldCheck, Smartphone,
  Truck, Undo2, Upload, Wallet, X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/app/(app)/nav";
import { Badge, cx, IconTile, LinkButton, Sparkline } from "@/components/ui";
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

export default function LandingPage() {
  return (
    <SitePage>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute left-1/2 top-[-12rem] h-[36rem] w-[56rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute right-[-8rem] top-40 h-80 w-80 rounded-full bg-accent-2/20 blur-[100px]" aria-hidden />

        <div className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-24">
          <div className="animate-rise"><Eyebrow>For pharmacies and drug shops in Ghana, Nigeria &amp; Kenya</Eyebrow></div>
          <h1 className="mx-auto mt-6 max-w-4xl animate-rise text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.045em] text-fg [animation-delay:80ms] sm:text-7xl">
            Stop throwing away <span className="text-aurora">expired medicine.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl animate-rise text-lg leading-relaxed text-muted [animation-delay:160ms] sm:text-xl">
            Get alerts 90 days before stock expires, never run out of your top 50 products, and keep selling when the internet doesn&apos;t.
            A till and stock system built for how pharmacies actually work.
          </p>
          <div className="mt-9 flex animate-rise flex-wrap justify-center gap-3 [animation-delay:240ms]">
            <LinkButton href="/signup" size="lg">Start your {TRIAL_DAYS}-day free trial <ArrowRight className="h-4 w-4" aria-hidden /></LinkButton>
            <LinkButton href="/pricing" size="lg" variant="secondary">See pricing</LinkButton>
          </div>
          <p className="mt-4 animate-rise text-sm text-subtle [animation-delay:300ms]">No card required · Use your real stock · Free data export, always</p>
        </div>

        <ProductMockup />
      </section>

      {/* Trust strip */}
      <section aria-label="Works with" className="border-y border-line bg-surface/50">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-7 sm:px-6 md:flex-row md:justify-between">
          <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.18em] text-subtle">Works with what you have</p>
          <ul className="flex flex-wrap justify-center gap-x-7 gap-y-2 text-sm font-medium text-muted">
            {TRUST.map((t) => <li key={t} className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-accent-2" aria-hidden />{t}</li>)}
          </ul>
        </div>
      </section>

      {/* Bento features */}
      <section id="features" aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6 sm:py-32">
        <SectionHead id="features-title" eyebrow="Plug the two leaks" title={<>Expired stock and stock-outs, <span className="text-subtle">handled.</span></>}>
          Generic POS apps record sales. PharmaStock manages batches, expiry, FEFO and reorders — the things that quietly cost a pharmacy money.
        </SectionHead>

        <div className="mt-14 grid gap-4 lg:grid-cols-6">
          <Bento className="lg:col-span-4" icon={<CalendarClock />} title="Expiry alerts 90 days early" body="Every batch has its expiry date. At 90, 60 and 30 days you get an alert with the value at risk and a suggestion: discount it, move it to another branch, or send it back to the supplier while you still can.">
            <ul className="mt-6 space-y-2 text-xs" aria-hidden>
              {[["Amoxicillin 500 mg · batch AMX2207", "62 days", "Return to Ernest Chemists by 14 Dec", "yellow"], ["Coartem 20/120 · batch CT1188", "28 days", "Discount or transfer to Osu branch", "red"], ["ORS sachets · batch OR551", "88 days", "Sells 40/week — will clear in time", "green"]].map(([name, left, tip, tone]) => (
                <li key={name} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
                  <Badge tone={tone as "yellow" | "red" | "green"}>{left}</Badge>
                  <div className="min-w-0 flex-1"><p className="truncate font-medium text-fg">{name}</p><p className="truncate text-subtle">{tip}</p></div>
                </li>
              ))}
            </ul>
          </Bento>

          <Bento className="lg:col-span-2" icon={<ScanBarcode />} tone="teal" title="FEFO at the counter" body="Scan a product and the till takes stock from the batch that expires first — enforced, not just reported. Expired or recalled batches simply can't be sold." />

          <Bento className="lg:col-span-2" icon={<Boxes />} tone="green" title="Never run out of your top 50" body="Reorder points per item and a suggested purchase order from real sales velocity. Send it to your supplier on WhatsApp in one tap.">
            <div className="mt-6 flex items-end justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-xs" aria-hidden>
              <div><p className="text-subtle">Paracetamol 500 mg</p><p className="font-medium text-fg">Reorder 20 boxes</p></div>
              <Sparkline values={[8, 11, 9, 14, 12, 16, 18]} className="h-7 w-16" />
            </div>
          </Bento>

          <Bento className="lg:col-span-2" icon={<MessageCircle />} title="Your day on WhatsApp" body="Every evening: sales and margin, cash versus mobile money, credit given, near-expiry value and what to reorder — even when you're not in the shop.">
            <p className="mt-6 max-w-[95%] rounded-2xl rounded-bl-md border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted" aria-hidden>
              Today: GH₵ 6,240 sales · 31% margin · MoMo GH₵ 2,980 · 4 items to reorder · GH₵ 1,150 expiring within 60 days.
            </p>
          </Bento>

          <Bento className="lg:col-span-2" icon={<Undo2 />} tone="blue" title="Returns calendar" body="Knows each supplier's return rules, and tells you which batches can still go back, to whom and by when — then tracks the credit note." />

          <Bento className="lg:col-span-3" icon={<ShieldCheck />} title="Prescriptions and the controlled-drug register" body="Prescription records with refill reminders, pharmacist sign-off for P and POM items, and a controlled-drug register with a running balance in the format inspectors expect. The software supports, but never replaces, the pharmacist's judgment." />

          <Bento className="lg:col-span-3" icon={<Download />} tone="teal" title="Transparent pricing. Your data is always yours." body="A published monthly price in your currency. Alerts, backups and full data export are in every plan — even on a read-only account. Stop paying and you keep read access. No exit fees, ever." />
        </div>
      </section>

      {/* Offline spotlight */}
      <section aria-labelledby="offline-title" className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="glass relative grid items-center gap-10 overflow-hidden p-8 sm:p-12 lg:grid-cols-2">
          <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-accent-2/15 blur-3xl" aria-hidden />
          <div className="relative">
            <IconTile tone="teal" className="h-11 w-11"><CloudOff /></IconTile>
            <h2 id="offline-title" className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl">Works even when <span className="text-aurora">the internet does not.</span></h2>
            <p className="mt-4 leading-relaxed text-muted">
              The till never blocks a sale because the connection dropped. Sales are saved on the device and sync the moment you&apos;re back online —
              each one recorded exactly once. If stock ran short while you were offline, you get an alert instead of a lost sale.
            </p>
          </div>
          <ul className="relative grid gap-3 sm:grid-cols-2">
            {["Runs on low-cost Android phones and old laptops", "Scan with a USB scanner or the phone camera", "Prints 80mm thermal receipts or sends them on WhatsApp", "Every sale synced once, even if the connection flickers"].map((x) => (
              <li key={x} className="rounded-2xl border border-line bg-surface p-4 text-sm text-fg">
                <Check className="mb-2 h-4 w-4 text-ok" aria-hidden />{x}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section id="how" aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6 sm:py-32">
        <SectionHead id="how-title" eyebrow="How it works" title="Notebook on Monday. PharmaStock by Friday.">
          No server in the back room and no long contract. Load your stock, scan your shelves and start selling.
        </SectionHead>
        <div className="relative mt-14">
          <div className="pointer-events-none absolute inset-x-8 top-[2.15rem] hidden h-px bg-gradient-to-r from-accent-2/0 via-accent/50 to-accent-2/0 lg:block" aria-hidden />
          <ol className="relative grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="glass relative p-6 transition duration-300 hover:-translate-y-1 hover:border-line-strong">
                <div className="flex items-center justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-aurora text-on-accent shadow-glow [&>svg]:h-5 [&>svg]:w-5" aria-hidden><s.icon /></span>
                  <span className="font-mono text-xs text-subtle">0{i + 1}</span>
                </div>
                <h3 className="mt-5 font-semibold text-fg">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Comparison */}
      <section aria-labelledby="compare-title" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 sm:pb-32">
        <SectionHead id="compare-title" eyebrow="Why pharmacies switch" title="More than a billing app">
          Notebooks, spreadsheets and generic POS apps don&apos;t know about batches or expiry dates. That&apos;s where the money goes.
        </SectionHead>
        <div className="glass mt-12 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-5 py-4"><span className="sr-only">Feature</span></th>
                <th scope="col" className="bg-accent/10 px-5 py-4"><span className="flex items-center gap-2 font-semibold text-fg"><LogoMark className="h-6 w-6 rounded-lg" />PharmaStock</span></th>
                <th scope="col" className="px-5 py-4 font-semibold text-muted">Paper, Excel or a generic POS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COMPARE.map(([k, us, them]) => (
                <tr key={k}>
                  <th scope="row" className="whitespace-nowrap px-5 py-4 font-medium text-fg">{k}</th>
                  <td className="bg-accent/10 px-5 py-4 text-fg"><span className="flex gap-2.5"><Check className="h-4 w-4 shrink-0 text-ok" aria-hidden />{us}</span></td>
                  <td className="px-5 py-4 text-muted"><span className="flex gap-2.5"><X className="h-4 w-4 shrink-0 text-subtle" aria-hidden />{them}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing teaser */}
      <section aria-labelledby="price-title" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6 sm:pb-32">
        <SectionHead id="price-title" eyebrow="Pricing" title={<>Transparent pricing from <span className="text-aurora"><Price of={{ plan: "starter" }} />/month</span></>}>
          {TRIAL_DAYS}-day free trial with your real stock, no card. Pay monthly, or yearly and get 2 months free. Free data export, always.
          <span className="mt-4 block"><PriceCurrencySwitcher /></span>
        </SectionHead>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {(Object.entries(PLANS) as [PlanKey, (typeof PLANS)[PlanKey]][]).map(([key, p]) => (
            <Link key={key} href={`/pricing#${key}`} className={cx("glass group relative block p-6 transition duration-300 hover:-translate-y-1 hover:border-line-strong", key === "pro" && "ring-aurora shadow-glow")}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-fg">{p.name}</h3>
                {key === "pro" && <Badge tone="purple">Most popular</Badge>}
              </div>
              <p className="mt-4"><span className="text-4xl font-semibold tracking-[-0.03em] text-fg tabular-nums"><Price of={{ plan: key }} /></span><span className="text-muted">/month{key === "chain" ? " per branch" : ""}</span></p>
              <p className="mt-2 text-sm text-muted">{planLimitsLine(key)}</p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-accent">See what&apos;s included <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-center text-xs text-subtle">Chain is billed for at least {CHAIN_MIN_BRANCHES} branches. One-time setup service available: we load your stock, label your shelves and train your staff.</p>
      </section>

      <CtaBand title={<>Know what&apos;s expiring <span className="text-aurora">before it does.</span></>} body={`Start free for ${TRIAL_DAYS} days — no card, every feature on. Cancel any time and take all your data with you.`} />
    </SitePage>
  );
}

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-fg sm:text-5xl">{title}</h2>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Bento({ className, icon, tone = "purple", title, body, children }: {
  className?: string; icon: ReactNode; tone?: "purple" | "teal" | "green" | "blue"; title: string; body: string; children?: ReactNode;
}) {
  return (
    <article className={cx("glass group relative overflow-hidden p-6 transition duration-300 hover:-translate-y-0.5 hover:border-line-strong sm:p-7", className)}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-aurora opacity-[0.08] blur-3xl transition duration-500 group-hover:opacity-20" aria-hidden />
      <IconTile tone={tone}>{icon}</IconTile>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-fg">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
      {children}
    </article>
  );
}

/** Decorative glass mockup of the till + expiry alerts, built in JSX. */
function ProductMockup() {
  const cart: [string, string, string][] = [["Amoxicillin 500 mg caps", "2 strips · batch AMX2207", "GH₵ 36.00"], ["Paracetamol 500 mg", "1 box · batch PC0912", "GH₵ 22.50"], ["ORS sachet", "5 sachets · batch OR551", "GH₵ 12.50"]];
  return (
    <div className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6" aria-hidden>
      <div className="pointer-events-none absolute inset-x-10 top-10 h-3/4 rounded-full bg-aurora opacity-25 blur-[90px]" />
      <div className="relative animate-rise [animation-delay:380ms] [perspective:2000px]">
        <div className="glass ring-aurora overflow-hidden rounded-[1.75rem] bg-solid/60 shadow-glow transition duration-700 lg:[transform:rotateX(8deg)] lg:hover:[transform:rotateX(0deg)]">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <span className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-bad/70" /><span className="h-2.5 w-2.5 rounded-full bg-warn/70" /><span className="h-2.5 w-2.5 rounded-full bg-ok/70" /></span>
            <span className="mx-auto rounded-lg border border-line bg-surface px-3 py-1 text-[11px] text-subtle">Till · Main branch</span>
            <span className="w-12" />
          </div>

          <div className="flex text-left">
            <div className="hidden w-52 shrink-0 flex-col gap-1 border-r border-line p-3 md:flex">
              <div className="mb-3 flex items-center gap-2 px-2"><LogoMark className="h-7 w-7 rounded-lg" /><span className="text-sm font-semibold text-fg">PharmaStock</span></div>
              {["Dashboard", "Till", "Alerts", "Products", "Stock & batches", "Purchasing", "Reports"].map((n) => (
                <div key={n} className={cx("rounded-lg px-3 py-2 text-xs", n === "Till" ? "bg-surface-3 font-medium text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-subtle")}>{n}</div>
              ))}
            </div>

            <div className="min-w-0 flex-1 p-4 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[11px] text-subtle">Sale SL-001284 · Main branch</p><p className="font-semibold text-fg">Scan or search a product</p></div>
                <Badge tone="green" pulse>Synced</Badge>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <ul className="space-y-2">
                  {cart.map(([name, meta, price], i) => (
                    <li key={name} className="flex animate-rise items-center gap-3 rounded-xl border border-line bg-surface p-3" style={{ animationDelay: `${500 + i * 90}ms` }}>
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent"><ScanBarcode className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-fg">{name}</p><p className="truncate font-mono text-[10px] text-subtle">{meta} · FEFO</p></div>
                      <span className="text-xs font-medium tabular-nums text-fg">{price}</span>
                    </li>
                  ))}
                </ul>
                <div className="space-y-3">
                  <div className="rounded-2xl border border-line bg-surface p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-subtle">Total</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">GH₵ 71.00</p>
                    <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px]">{["Cash", "MoMo", "Card"].map((m, i) => <span key={m} className={cx("rounded-lg border px-2 py-1.5 text-center", i === 1 ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted")}>{m}</span>)}</div>
                  </div>
                  <div className="rounded-2xl border border-warn/30 bg-warn/12 p-3 text-[11px]">
                    <p className="flex items-center gap-1.5 font-medium text-warn"><PackageX className="h-3.5 w-3.5" />Expiring in 60 days</p>
                    <p className="mt-1 text-muted">GH₵ 1,150 at cost · 6 batches</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass absolute -left-2 bottom-10 hidden animate-rise items-center gap-3 bg-solid/80 px-4 py-3 shadow-glow [animation-delay:1300ms] sm:flex lg:-left-10">
          <IconTile tone="teal" className="h-8 w-8"><Truck /></IconTile>
          <div className="text-left"><p className="text-xs font-medium text-fg">Purchase order sent on WhatsApp</p><p className="text-[11px] text-muted">PO-000088 · 14 items to Ernest Chemists</p></div>
        </div>
        <div className="glass absolute -right-2 top-24 hidden animate-rise items-center gap-3 bg-solid/80 px-4 py-3 shadow-glow [animation-delay:1600ms] sm:flex lg:-right-10">
          <IconTile tone="green" className="h-8 w-8"><Wallet /></IconTile>
          <div className="text-left"><p className="text-xs font-medium text-fg">MoMo payment received</p><p className="text-[11px] text-muted tabular-nums">GH₵ 71.00 · RCT-000931</p></div>
        </div>
      </div>
    </div>
  );
}
