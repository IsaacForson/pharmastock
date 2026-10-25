"use client";
import {
  ArrowLeftRight, BadgeCheck, BarChart3, BellRing, Bike, Boxes, Building2, FileText, LayoutDashboard, Menu, MessageSquare,
  Moon, PackagePlus, Pill, Receipt, ScanLine, Settings, ShieldCheck, ShoppingCart, Sparkles, Sun, Truck, Undo2, Users, Wallet, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "@/components/ui";

export const ICONS = { LayoutDashboard, ScanLine, Receipt, BellRing, Users, FileText, Bike, Pill, Boxes, ShoppingCart, PackagePlus, Truck, Undo2, ArrowLeftRight, ShieldCheck, Wallet, BadgeCheck, BarChart3, Sparkles, MessageSquare, Building2, Settings };
/** `group` is the top-bar section the page belongs to. */
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; group?: string };

/** Brand mark: a dispensing-label monogram on a green tab. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-[4px] bg-brand font-mono text-[13px] font-semibold leading-none tracking-tighter", className ?? "h-7 w-7")} aria-hidden>
      Rx
    </span>
  );
}

const isOn = (path: string, href: string) => path === href || path.startsWith(href + "/");

/**
 * Two-tier top navigation: sections across the dark header bar, the active section's pages as tabs underneath.
 * On small screens both collapse into one drawer.
 */
export function TopNav({ items, pharmacy, right }: { items: NavItem[]; pharmacy: string; right: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const sections = [...new Set(items.map((i) => i.group ?? "Pages"))];
  const current = items.find((i) => isOn(path, i.href))?.group ?? sections[0];
  const tabs = items.filter((i) => (i.group ?? "Pages") === current);

  return (
    <header className="sticky top-0 z-30 print:hidden">
      <div className="bg-header text-on-header">
        <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-3 px-3 lg:gap-6 lg:px-6">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="grid h-8 w-8 place-items-center rounded text-on-header-muted hover:text-on-header lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5" aria-label="PharmaStock home">
            <LogoMark />
            <span className="text-[14px] font-semibold tracking-tight">PharmaStock</span>
            <span className="hidden max-w-[16ch] truncate border-l border-on-header/20 pl-2.5 text-[12px] text-on-header-muted xl:inline">{pharmacy}</span>
          </Link>
          <nav className="hidden h-full items-stretch lg:flex" aria-label="Sections">
            {sections.map((s) => {
              const first = items.find((i) => (i.group ?? "Pages") === s)!;
              const on = s === current;
              return (
                <Link key={s} href={first.href} aria-current={on ? "true" : undefined}
                  className={cx("flex items-center border-b-2 px-3 text-[13px] font-medium transition-colors", on ? "border-accent-2 text-on-header" : "border-transparent text-on-header-muted hover:text-on-header")}>
                  {s}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">{right}</div>
        </div>
      </div>
      <div className="hidden border-b border-line bg-surface lg:block">
        <nav className="mx-auto flex h-10 max-w-[1440px] items-stretch gap-1 overflow-x-auto px-6" aria-label={`${current} pages`}>
          {tabs.map((i) => {
            const Icon = ICONS[i.icon];
            const on = isOn(path, i.href);
            return (
              <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
                className={cx("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 text-[13px] transition-colors", on ? "border-accent font-semibold text-fg" : "border-transparent text-muted hover:text-fg")}>
                <Icon className={cx("h-[15px] w-[15px]", on ? "text-accent" : "text-subtle")} aria-hidden />
                {i.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex w-[300px] max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-surface">
            <div className="flex h-12 items-center justify-between bg-header px-3 text-on-header">
              <span className="flex items-center gap-2.5"><LogoMark /><span className="text-[14px] font-semibold">PharmaStock</span></span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded text-on-header-muted hover:text-on-header"><X className="h-5 w-5" /></button>
            </div>
            <div className="truncate border-b border-line px-4 py-2 text-[12px] text-muted">{pharmacy}</div>
            {sections.map((s) => (
              <div key={s} className="border-b border-line py-2">
                <div className="px-4 pb-1 pt-1 font-mono text-[11px] uppercase tracking-wider text-subtle">{s}</div>
                {items.filter((i) => (i.group ?? "Pages") === s).map((i) => {
                  const Icon = ICONS[i.icon];
                  const on = isOn(path, i.href);
                  return (
                    <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={on ? "page" : undefined}
                      className={cx("flex items-center gap-2.5 px-4 py-2 text-sm", on ? "mark-brand bg-surface-2 font-semibold text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                      <Icon className={cx("h-4 w-4", on ? "text-accent" : "text-subtle")} aria-hidden />{i.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
          <button className="flex-1 bg-fg/40" aria-label="Close menu" onClick={() => setOpen(false)} />
        </div>
      )}
    </header>
  );
}

// Theme: "light" (default) | "dark" (night shift), stored in localStorage (applied before paint by the root layout script).
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
};
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme ?? "light", () => "light");
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" aria-label={next === "dark" ? "Switch to night mode" : "Switch to day mode"} title={next === "dark" ? "Night mode" : "Day mode"}
      onClick={() => { document.documentElement.dataset.theme = next; try { localStorage.setItem("ps-theme", next); } catch {} }}
      className={cx("grid h-8 w-8 place-items-center rounded transition-colors", className ?? "text-muted hover:bg-surface-2 hover:text-fg")}>
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
