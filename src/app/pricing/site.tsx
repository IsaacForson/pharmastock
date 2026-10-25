// Shared chrome for the public marketing pages (/, /pricing, /terms, /privacy, /security).
import { ArrowRight, Menu } from "lucide-react";
import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";
import { LogoMark, ThemeToggle } from "@/app/(app)/nav";
import { cx } from "@/components/ui";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cx("flex items-center gap-2.5 font-semibold tracking-tight text-fg", className)} aria-label="PharmaStock home">
      <LogoMark className="h-8 w-8 text-[14px]" />
      <span>PharmaStock</span>
    </Link>
  );
}

const NAV = [["/#features", "Features"], ["/#how", "How it works"], ["/pricing", "Pricing"], ["/security", "Security"]] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 bg-header text-on-header">
      <a href="#main" className="sr-only rounded bg-solid px-4 py-2 text-sm font-medium text-fg focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">Skip to content</a>
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold" aria-label="PharmaStock home"><LogoMark className="h-8 w-8 text-[14px]" /> PharmaStock</Link>
        <nav aria-label="Main" className="hidden h-full items-stretch text-[13px] md:flex">
          {NAV.map(([href, label]) => <Link key={href} href={href} className="flex items-center border-b-2 border-transparent px-3.5 text-on-header-muted transition-colors hover:border-accent-2 hover:text-on-header">{label}</Link>)}
        </nav>
        <div className="flex items-center gap-1.5">
          <ThemeToggle className="grid h-8 w-8 place-items-center rounded text-on-header-muted hover:bg-on-header/10 hover:text-on-header" />
          <Link href="/login" className="hidden px-3 py-2 text-[13px] text-on-header-muted hover:text-on-header sm:block">Sign in</Link>
          <Link href="/signup" className="inline-flex h-8 items-center rounded bg-accent px-3 text-[13px] font-semibold text-on-accent hover:bg-accent-strong">Start free trial</Link>
          {/* No-JS mobile menu */}
          <details className="relative md:hidden">
            <summary aria-label="Menu" className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded text-on-header-muted hover:text-on-header [&::-webkit-details-marker]:hidden">
              <Menu className="h-4 w-4" aria-hidden />
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 top-10 w-52 rounded border border-line bg-solid py-1 text-sm shadow-lift">
              {[...NAV, ["/login", "Sign in"] as const].map(([href, label]) => (
                <Link key={href} href={href} className="block px-4 py-2.5 text-fg hover:bg-surface-2">{label}</Link>
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
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs leading-relaxed text-muted">Pharmacy POS and inventory for independent pharmacies, drug shops and chains in Ghana, Nigeria and Kenya.</p>
          <p className="font-mono text-[11px] text-subtle">Alerts, backups &amp; data export in every plan.</p>
        </div>
        {FOOTER.map(([title, links]) => (
          <nav key={title} aria-label={title} className="space-y-2.5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-subtle">{title}</p>
            {links.map(([href, label]) => <Link key={href} href={href} className="block text-muted hover:text-fg hover:underline">{label}</Link>)}
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 text-xs text-subtle sm:flex-row sm:justify-between sm:px-6">
          <p>© PharmaStock. Supports, but does not replace, pharmacist judgment.</p>
          <p className="font-mono">GH · NG · KE</p>
        </div>
      </div>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  return (
    <div className="page-bg flex min-h-screen flex-col text-fg">
      <SiteHeader />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}

/** Section kicker: mono label with a short brand rule. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-wider text-accent"><span className="h-px w-6 bg-accent" aria-hidden />{children}</p>;
}

const slug = (s: string) => s.toLowerCase().replace(/^\d+\.\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** A titled section of a DocPage; DocPage builds its table of contents from these. */
export function Sec({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section id={slug(title)} className="scroll-mt-28">
      <h2 className="flex items-center gap-3">
        {icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-accent/25 bg-accent/15 text-accent [&>svg]:h-[18px] [&>svg]:w-[18px]" aria-hidden>{icon}</span>}
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
      {toc.map((t) => <li key={t}><a href={`#${slug(t)}`} className="block rounded px-3 py-1.5 text-muted transition hover:bg-surface-2 hover:text-fg">{t}</a></li>)}
    </ol>
  );
  return (
    <SitePage>
      <header className="relative mx-auto max-w-6xl px-4 pb-10 pt-16 sm:px-6 sm:pt-20">
        <div className="relative">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.03em] text-fg sm:text-5xl">{title}</h1>
          <p className="mt-3 text-sm text-subtle">Last updated {updated}</p>
          <div className="mt-6 max-w-2xl text-lg leading-relaxed text-muted">{intro}</div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <details className="sheet p-3 lg:hidden">
            <summary className="cursor-pointer px-3 py-1 text-sm font-medium text-fg">On this page</summary>
            <nav aria-label="On this page" className="mt-2">{tocLinks}</nav>
          </details>
          <nav aria-label="Table of contents" className="hidden lg:block">
            <p className="mb-3 px-3 text-[11px] font-mono uppercase tracking-wider text-subtle">On this page</p>
            <div className="border-l border-line">{tocLinks}</div>
          </nav>
        </aside>
        <article className={cx(
          "sheet space-y-12 p-6 leading-relaxed text-muted sm:p-10",
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

/** Closing call to action shared by marketing pages: a full-width band in the header green. */
export function CtaBand({ title, body }: { title: ReactNode; body: ReactNode }) {
  return (
    <section className="bg-header text-on-header">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
          <p className="mt-3 text-on-header-muted">{body}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          <Link href="/signup" className="inline-flex h-11 items-center gap-2 rounded bg-accent px-5 font-semibold text-on-accent hover:bg-accent-strong">Start free trial <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          <Link href="/pricing" className="inline-flex h-11 items-center rounded border border-on-header/30 px-5 font-medium text-on-header hover:bg-on-header/10">Compare plans</Link>
        </div>
      </div>
    </section>
  );
}
