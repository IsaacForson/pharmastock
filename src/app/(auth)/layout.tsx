import { CalendarClock, PackageCheck, ShieldCheck, WifiOff } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "../(app)/nav";

const PULSE = [
  { icon: CalendarClock, label: "Expiry warning", value: "90 days", tone: "text-ok" },
  { icon: PackageCheck, label: "Batch picked at the till", value: "FEFO", tone: "text-accent-2" },
  { icon: WifiOff, label: "Sales lost to bad internet", value: "0", tone: "text-accent" },
];

/** Split-screen auth: cinematic brand panel + glass form. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="backdrop-os relative grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -left-32 top-10 h-[28rem] w-[28rem] rounded-full bg-accent/25 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-accent-2/20 blur-[120px]" aria-hidden />
        <Link href="/" className="relative flex items-center gap-3 text-lg font-semibold tracking-tight">
          <LogoMark className="h-10 w-10" /> PharmaStock
        </Link>

        <div className="relative max-w-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-accent-2">Pharmacy operating system</p>
          <h2 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-[-0.03em]">
            Stop throwing away<br /><span className="text-aurora">expired medicine.</span>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted">Batches, expiry alerts, FEFO at the counter, reorder lists and a WhatsApp summary every evening — built for independent pharmacies and chains, and the till keeps selling when the internet doesn&apos;t.</p>

          <div className="mt-10 grid grid-cols-3 gap-3">
            {PULSE.map((p, i) => (
              <div key={p.label} className="glass p-4 animate-rise" style={{ animationDelay: `${120 + i * 90}ms` }}>
                <p.icon className={`h-4 w-4 ${p.tone}`} aria-hidden />
                <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{p.value}</div>
                <div className="mt-0.5 text-[11px] text-subtle">{p.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-subtle">
          <ShieldCheck className="h-4 w-4 text-ok" aria-hidden /> Encrypted records · Per-pharmacy isolation · Your data is always yours
        </div>
      </section>

      <section className="relative flex flex-col items-center justify-center px-4 py-12 sm:px-8">
        <Link href="/" className="mb-8 flex items-center gap-3 text-lg font-semibold tracking-tight lg:hidden">
          <LogoMark /> PharmaStock
        </Link>
        <div className="glass ring-aurora w-full max-w-[440px] p-7 sm:p-9 animate-rise">{children}</div>
        <p className="mt-6 text-center text-xs text-subtle">
          <Link href="/privacy" className="hover:text-fg">Privacy</Link> · <Link href="/terms" className="hover:text-fg">Terms</Link> · <Link href="/security" className="hover:text-fg">Security</Link>
        </p>
      </section>
    </main>
  );
}
