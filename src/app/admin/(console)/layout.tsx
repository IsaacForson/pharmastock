import { LogOut, ShieldHalf } from "lucide-react";
import { Suspense } from "react";
import { PLATFORM_ROLE_LABELS, platformCan, requireAdmin, type PlatformCap } from "@/lib/platform-auth";
import { LogoMark, ThemeToggle } from "../../(app)/nav";
import { CURRENCIES } from "@/lib/countries";
import { adminLogoutAction } from "../auth-actions";
import { setAdminCurrencyAction } from "./actions";
import { adminCurrency } from "./money";
import { AdminNav, type AdminNavItem } from "./admin-nav";

export const instant = false;
export const metadata = { title: { template: "%s · PharmaStock Control", default: "PharmaStock Control" }, robots: { index: false } };

const NAV: (AdminNavItem & { cap?: PlatformCap })[] = [
  { href: "/admin", label: "Overview", icon: "Gauge" },
  { href: "/admin/pharmacies", label: "Pharmacies", icon: "Building2" },
  { href: "/admin/recalls", label: "Recalls", icon: "Siren", cap: "recalls.manage" },
  { href: "/admin/revenue", label: "Revenue", icon: "CircleDollarSign", cap: "revenue.view" },
  { href: "/admin/pricing", label: "Pricing & currency", icon: "Coins", cap: "pharmacies.billing" },
  { href: "/admin/system", label: "System health", icon: "Activity", cap: "system.jobs" },
  { href: "/admin/team", label: "Team", icon: "Users", cap: "team.manage" },
  { href: "/admin/audit", label: "Audit log", icon: "ScrollText" },
];

const headerBtn = "grid h-8 w-8 place-items-center rounded text-on-header-muted hover:bg-on-header/10 hover:text-on-header";

/** Control uses the same two-row top bar as the pharmacy app, marked "Control" so the team always knows where they are. */
async function Bar() {
  const { admin } = await requireAdmin();
  return (
    <header className="sticky top-0 z-30">
      <div className="bg-header text-on-header">
        <div className="mx-auto flex h-12 max-w-[1500px] items-center gap-3 px-4 lg:px-6">
          <LogoMark />
          <span className="text-[14px] font-semibold">PharmaStock</span>
          <span className="flex items-center gap-1 rounded-sm border border-accent-2/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-2"><ShieldHalf className="h-3 w-3" />Control</span>
          <form action={setAdminCurrencyAction} className="ml-auto hidden items-center gap-1.5 md:flex">
            <label htmlFor="ps-cur" className="text-[11px] text-on-header-muted">Money in</label>
            <select id="ps-cur" name="currency" defaultValue={admin.currency ?? "auto"} className="h-8 rounded-l border border-on-header/20 bg-header px-2 text-[12px] text-on-header">
              <option value="auto">Auto · {await adminCurrency({ currency: null })}</option>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="-ml-1.5 h-8 rounded-r border border-on-header/20 px-2 text-[12px] text-on-header-muted hover:text-on-header">Set</button>
          </form>
          <span className="hidden text-[12px] md:inline">{admin.name} <span className="text-on-header-muted">· {PLATFORM_ROLE_LABELS[admin.role]}</span></span>
          <ThemeToggle className={headerBtn} />
          <form action={adminLogoutAction}><button aria-label="Sign out" title="Sign out" className={headerBtn}><LogOut className="h-4 w-4" /></button></form>
        </div>
      </div>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[1500px] px-4 lg:px-6">
          <AdminNav items={NAV.filter((n) => !n.cap || platformCan(admin.role, n.cap)).map(({ href, label, icon }) => ({ href, label, icon }))} />
        </div>
      </div>
    </header>
  );
}

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-bg min-h-screen text-fg">
      <Suspense fallback={<div className="h-[88px] bg-header" />}><Bar /></Suspense>
      <main className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 lg:px-6">
        <Suspense fallback={<div className="space-y-4"><div className="skeleton h-9 w-72" /><div className="skeleton h-64" /></div>}>{children}</Suspense>
      </main>
    </div>
  );
}
