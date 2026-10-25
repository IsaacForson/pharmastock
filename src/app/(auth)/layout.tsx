import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "../(app)/nav";

const FACTS = [
  ["90 d", "Expiry warning before a batch goes off"],
  ["FEFO", "Earliest-expiring batch picked at the till"],
  ["0", "Sales lost when the internet drops"],
  ["21:30", "Owner summary on WhatsApp every evening"],
];

/** Sign-in and sign-up: the app's own header bar over a single ruled sheet, with a ledger of what the product does. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-bg flex min-h-screen flex-col">
      <header className="bg-header text-on-header">
        <div className="mx-auto flex h-12 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5 text-[14px] font-semibold"><LogoMark /> PharmaStock</Link>
          <Link href="/pricing" className="text-[12px] text-on-header-muted hover:text-on-header">Pricing</Link>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="sheet grid w-full max-w-[860px] overflow-hidden lg:grid-cols-[1fr_330px]">
          <section className="p-6 sm:p-9">{children}</section>
          <aside className="hidden border-l border-line bg-surface-2 p-6 lg:flex lg:flex-col">
            <div className="font-mono text-[11px] uppercase tracking-wider text-subtle">Built for the dispensary</div>
            <p className="mt-2 text-[15px] font-semibold leading-snug text-fg">Stop throwing away expired medicine, and never run out of your top sellers.</p>
            <dl className="mt-5 divide-y divide-line border-y border-line">
              {FACTS.map(([v, k]) => (
                <div key={k} className="flex items-baseline gap-3 py-2.5">
                  <dt className="w-14 shrink-0 font-mono text-[15px] font-semibold text-accent">{v}</dt>
                  <dd className="text-[13px] leading-snug text-muted">{k}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-auto flex items-start gap-2 pt-6 text-[12px] text-subtle">
              <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-ok" aria-hidden /> Encrypted records, each pharmacy kept apart, and your data is always yours to export.
            </p>
          </aside>
        </div>
      </div>

      <footer className="pb-6 text-center text-xs text-subtle">
        <Link href="/privacy" className="hover:text-fg">Privacy</Link> · <Link href="/terms" className="hover:text-fg">Terms</Link> · <Link href="/security" className="hover:text-fg">Security</Link>
      </footer>
    </main>
  );
}
