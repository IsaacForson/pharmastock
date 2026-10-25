"use client";
import {
  ArrowLeftRight, BadgeCheck, BarChart3, BellRing, Bike, Boxes, Building2, ChevronsLeft, FileText, LayoutDashboard, Menu, MessageSquare,
  Moon, PackagePlus, Pill, Receipt, ScanLine, Settings, ShieldCheck, ShoppingCart, Sparkles, Sun, Truck, Undo2, Users, Wallet, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cx } from "@/components/ui";

export const ICONS = { LayoutDashboard, ScanLine, Receipt, BellRing, Users, FileText, Bike, Pill, Boxes, ShoppingCart, PackagePlus, Truck, Undo2, ArrowLeftRight, ShieldCheck, Wallet, BadgeCheck, BarChart3, Sparkles, MessageSquare, Building2, Settings };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; group?: string };

export function LogoMark({ className }: { className?: string }) {
  return (
    <span className={cx("relative grid shrink-0 place-items-center rounded-xl bg-aurora text-on-accent shadow-glow", className ?? "h-9 w-9")} aria-hidden>
      <svg viewBox="0 0 64 64" className="h-1/2 w-1/2"><path fill="currentColor" d="M22 4a18 18 0 0 1 25.5 0l12.5 12.5a18 18 0 0 1 0 25.5L42 60a18 18 0 0 1-25.5 0L4 47.5a18 18 0 0 1 0-25.5zm-8 18a8 8 0 0 0 0 11.3l5.7 5.7L39 19.7 33.3 14A8 8 0 0 0 22 14z" /></svg>
    </span>
  );
}

// Sidebar collapsed state persists per device.
const COLLAPSE_KEY = "ps-rail";
const subscribeStorage = (cb: () => void) => { window.addEventListener("ps-rail", cb); return () => window.removeEventListener("ps-rail", cb); };
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

export function useRailCollapsed() {
  return useSyncExternalStore(subscribeStorage, readCollapsed, () => false);
}
function setCollapsed(v: boolean) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch {}
  document.documentElement.dataset.rail = v ? "collapsed" : "open";
  window.dispatchEvent(new Event("ps-rail"));
}

/** Floating glass sidebar. Collapses to an icon rail on desktop; slides in on mobile. */
export function Nav({ items, footer, clinic }: { items: NavItem[]; footer: React.ReactNode; clinic: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const collapsed = useRailCollapsed();
  useEffect(() => { document.documentElement.dataset.rail = collapsed ? "collapsed" : "open"; }, [collapsed]);

  return (
    <>
      <button onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"}
        className="fixed left-3 top-3 z-50 grid h-11 w-11 place-items-center rounded-2xl border border-line bg-solid text-fg shadow-panel lg:hidden print:hidden">
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      <aside className={cx(
        "fixed inset-y-3 left-3 z-40 flex flex-col overflow-hidden rounded-3xl border border-line bg-solid/80 shadow-panel backdrop-blur-2xl transition-[width,transform] duration-300 print:hidden",
        collapsed ? "lg:w-[76px]" : "lg:w-[248px]", "w-[248px]", open ? "translate-x-0" : "-translate-x-[110%] lg:translate-x-0",
      )}>
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-accent/25 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 -right-10 h-48 w-48 rounded-full bg-accent-2/15 blur-3xl" aria-hidden />

        <div className={cx("relative flex items-center gap-3 px-4 pb-3 pt-4", collapsed && "lg:justify-center lg:px-0")}>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3" aria-label="PharmaStock home">
            <LogoMark />
            <span className={cx("min-w-0", collapsed && "lg:hidden")}>
              <span className="block text-[15px] font-semibold tracking-tight text-fg">PharmaStock</span>
              <span className="block truncate text-[11px] text-subtle">{clinic}</span>
            </span>
          </Link>
        </div>

        <nav className="relative flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-3 pb-3" aria-label="Main">
          {items.map((i, idx) => {
            const Icon = ICONS[i.icon];
            const active = path === i.href || path.startsWith(i.href + "/");
            const label = i.group && i.group !== items[idx - 1]?.group ? i.group : null;
            return (
              <div key={i.href}>
                {label && (collapsed
                  ? <div className="mx-auto my-3 hidden h-px w-6 bg-line lg:block" aria-hidden />
                  : null)}
                {label && <div className={cx("px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle", collapsed && "lg:hidden")}>{label}</div>}
                <Link href={i.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} title={collapsed ? i.label : undefined}
                  className={cx("group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[13.5px] font-medium transition",
                    collapsed && "lg:justify-center lg:px-0",
                    active ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                  {active && <span className="absolute inset-0 rounded-2xl ring-aurora" aria-hidden />}
                  <Icon className={cx("h-[18px] w-[18px] shrink-0 transition", active ? "text-accent-2" : "text-subtle group-hover:text-fg")} aria-hidden />
                  <span className={cx("truncate", collapsed && "lg:hidden")}>{i.label}</span>
                  {active && <span className={cx("ml-auto h-1.5 w-1.5 rounded-full bg-accent-2 shadow-[0_0_12px_var(--accent-2)]", collapsed && "lg:hidden")} aria-hidden />}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="relative border-t border-line p-3">
          {footer}
          <div className={cx("mt-2 flex items-center gap-1", collapsed ? "lg:flex-col" : "")}>
            <ThemeToggle />
            <button onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand" : "Collapse"}
              className="hidden h-9 w-9 place-items-center rounded-xl text-subtle transition hover:bg-surface-2 hover:text-fg lg:grid">
              <ChevronsLeft className={cx("h-4 w-4 transition", collapsed && "rotate-180")} />
            </button>
          </div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-canvas/60 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

// Theme: "dark" | "light", stored in localStorage (applied before paint by the root layout script).
const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
};
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme ?? "dark", () => "dark");
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}
      onClick={() => { document.documentElement.dataset.theme = next; try { localStorage.setItem("ps-theme", next); } catch {} }}
      className={cx("grid h-9 w-9 place-items-center rounded-xl text-subtle transition hover:bg-surface-2 hover:text-fg", className)}>
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
