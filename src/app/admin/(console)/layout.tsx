import { LogOut, ShieldHalf } from "lucide-react";
import { Suspense } from "react";
import { Avatar, Badge } from "@/components/ui";
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

async function Side() {
  const { admin } = await requireAdmin();
  return (
    <aside className="glass flex flex-col gap-4 p-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
      <div className="flex items-center gap-3 px-1">
        <LogoMark />
        <div>
          <div className="text-[15px] font-semibold tracking-tight">PharmaStock <span className="text-aurora">Control</span></div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-subtle"><ShieldHalf className="h-3 w-3" />Platform admin</div>
        </div>
      </div>
      <AdminNav items={NAV.filter((n) => !n.cap || platformCan(admin.role, n.cap)).map(({ href, label, icon }) => ({ href, label, icon }))} />
      <form action={setAdminCurrencyAction} className="mt-auto flex items-center gap-2 border-t border-line pt-4">
        <label htmlFor="ps-cur" className="text-xs text-subtle">Show money in</label>
        <select id="ps-cur" name="currency" defaultValue={admin.currency ?? "auto"} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 text-xs text-fg">
          <option value="auto">Auto · {await adminCurrency({ currency: null })}</option>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="h-8 rounded-lg border border-line px-2 text-xs text-muted hover:text-fg">Set</button>
      </form>
      <div className="hidden items-center gap-3 border-t border-line pt-4 lg:flex">
        <Avatar name={admin.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{admin.name}</div>
          <Badge tone={admin.role === "super_admin" ? "purple" : admin.role === "finance" ? "green" : "blue"}>{PLATFORM_ROLE_LABELS[admin.role]}</Badge>
        </div>
        <ThemeToggle />
        <form action={adminLogoutAction}><button aria-label="Sign out" title="Sign out" className="grid h-9 w-9 place-items-center rounded-xl text-subtle hover:bg-surface-2 hover:text-fg"><LogOut className="h-4 w-4" /></button></form>
      </div>
    </aside>
  );
}

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="backdrop-os min-h-screen text-fg">
      <div className="mx-auto grid max-w-[1500px] gap-6 p-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:p-6">
        <Suspense fallback={<div className="glass h-40 lg:h-[calc(100vh-3rem)]" />}><Side /></Suspense>
        <main className="min-w-0 pb-16">
          <Suspense fallback={<div className="space-y-4"><div className="skeleton h-10 w-72" /><div className="skeleton h-64 rounded-[1.25rem]" /></div>}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
