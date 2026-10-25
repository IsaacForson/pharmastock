// Shared chrome for the public marketing pages (/, /pricing, /terms, /privacy, /security).
import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import { LogoMark, ThemeToggle } from "@/app/(app)/nav";
import { cx, LinkButton } from "@/components/ui";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cx("flex items-center gap-2.5 font-semibold tracking-tight text-fg", className)} aria-label="PharmaStock home">
      <LogoMark className="h-8 w-8" />
      <span>PharmaStock</span>
    </Link>
  );
}

const NAV = [["/#features", "Features"], ["/#how", "How it works"], ["/pricing", "Pricing"], ["/security", "Security"]] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <a href="#main" className="sr-only rounded-xl bg-solid px-4 py-2 text-sm font-medium text-fg shadow-panel focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">Skip to content</a>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-2xl border border-line bg-solid/70 pl-4 pr-2 shadow-panel backdrop-blur-xl">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="rounded-lg px-3 py-2 text-muted transition hover:bg-surface-2 hover:text-fg">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          <Link href="/login" className="hidden rounded-lg px-3 py-2 text-sm text-muted transition hover:text-fg sm:block">Sign in</Link>
          <LinkButton href="/signup" size="sm" className="h-9 px-3.5">Start free trial</LinkButton>
          {/* No-JS mobile menu */}
          <details className="relative md:hidden">
            <summary aria-label="Menu" className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden">
              <Menu className="h-4 w-4" aria-hidden />
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 top-11 w-52 rounded-2xl border border-line bg-solid p-2 text-sm shadow-panel">
              {[...NAV, ["/login", "Sign in"] as const].map(([href, label]) => (
                <Link key={href} href={href} className="block rounded-xl px-3 py-2.5 text-muted hover:bg-surface-2 hover:text-fg">{label}</Link>
              ))}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

const FOOTER: [string, [string, string][]][] = [
  ["Product", [["/#features", "Features"], ["/#how", "How it works"], ["/pricing", "Pricing"], ["/signup", "Start free trial"]]],
  ["Trust", [["/security", "Security"], ["/privacy", "Privacy policy"], ["/terms", "Terms of service"]]],
  ["Account", [["/login", "Sign in"], ["/signup", "Create a pharmacy account"]]],
];

export function SiteFooter() {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-line bg-canvas-2/60">
      <div className="pointer-events-none absolute inset-x-0 -top-px mx-auto h-px max-w-3xl bg-aurora opacity-60" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 text-sm sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs leading-relaxed text-muted">Pharmacy POS and inventory for independent pharmacies, drug shops and chains in Ghana, Nigeria and Kenya. Your data is always yours.</p>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />Alerts, backups &amp; data export included in every plan
          </p>
        </div>
        {FOOTER.map(([title, links]) => (
          <nav key={title} aria-label={title} className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">{title}</p>
            {links.map(([href, label]) => <Link key={href} href={href} className="block text-muted transition hover:text-fg">{label}</Link>)}
          </nav>
        ))}
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 border-t border-line px-4 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>© PharmaStock. Pharmacy software that supports, but does not replace, pharmacist judgment.</p>
        <p>Made for pharmacies in Ghana · Nigeria · Kenya</p>
      </div>
      <p className="pointer-events-none select-none text-center text-[18vw] font-semibold leading-[0.75] tracking-[-0.06em] text-fg opacity-[0.03]" aria-hidden>PharmaStock</p>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="backdrop-os flex min-h-screen flex-col text-fg">
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Small aurora eyebrow pill used above section headings. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-aurora" aria-hidden />{children}</p>;
}

const slug = (s: string) => s.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** A titled section of a DocPage; DocPage builds its table of contents from these. */
export function Sec({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section id={slug(title)} className="scroll-mt-28">
      <h2 className="flex items-center gap-3">
        {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/15 text-accent [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden>{icon}</span>}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Long-form legal/security page layout with a sticky table of contents. Children should be <Sec> elements. */
export function DocPage({ title, eyebrow = "Trust centre", updated, intro, children }: { title: string; eyebrow?: string; updated: string; intro: ReactNode; children: ReactNode }) {
  const toc = Children.toArray(children).flatMap((c) => (isValidElement<{ title?: unknown }>(c) && typeof c.props.title === "string" ? [c.props.title] : []));
  const tocLinks = (
    <ol className="space-y-0.5 text-sm">
      {toc.map((t) => <li key={t}><a href={`#${slug(t)}`} className="block rounded-lg px-3 py-1.5 text-muted transition hover:bg-surface-2 hover:text-fg">{t}</a></li>)}
    </ol>
  );
  return (
    <SitePage>
      <header className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 sm:pt-20">
        <div className="pointer-events-none absolute -top-10 left-0 h-64 w-64 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative animate-rise">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">{title}</h1>
          <p className="mt-3 text-sm text-subtle">Last updated {updated}</p>
          <div className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{intro}</div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="glass p-3 lg:hidden">
            <summary className="cursor-pointer px-3 py-1 text-sm font-medium text-fg">On this page</summary>
            <nav aria-label="On this page" className="mt-2">{tocLinks}</nav>
          </details>
          <nav aria-label="Table of contents" className="hidden lg:block">
            <p className="mb-3 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">On this page</p>
            <div className="border-l border-line">{tocLinks}</div>
          </nav>
        </aside>
        <article className={cx(
          "glass animate-rise space-y-12 p-6 leading-relaxed text-muted sm:p-10",
          "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-fg [&_strong]:text-fg [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_li]:marker:text-accent",
          "[&_a]:font-medium [&_a]:text-accent [&_a]:underline-offset-4 hover:[&_a]:underline",
          "[&_table]:mt-4 [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:py-2.5 [&_th]:pr-4 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.14em] [&_th]:text-subtle [&_td]:border-b [&_td]:border-line [&_td]:py-3 [&_td]:pr-4 [&_td]:align-top",
        )}>
          {children}
        </article>
      </div>
    </SitePage>
  );
}

/** Closing call to action shared by marketing pages. */
export function CtaBand({ title, body }: { title: ReactNode; body: ReactNode }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <div className="glass ring-aurora relative overflow-hidden px-6 py-14 text-center sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-accent-2/20 blur-3xl" aria-hidden />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">{title}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted">{body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <LinkButton href="/signup" size="lg">Start free trial <ArrowRight className="h-4 w-4" aria-hidden /></LinkButton>
            <LinkButton href="/pricing" size="lg" variant="secondary">Compare plans</LinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
