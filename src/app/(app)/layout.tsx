import { Eye, LogOut, Plus, ShieldAlert, Sparkles } from "lucide-react";
import { Callout, LinkButton } from "@/components/ui";
import Link from "next/link";
import { Suspense } from "react";
import { requireCtx } from "@/lib/auth";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { hasFeature, trialDaysLeft, type Feature } from "@/lib/plans";
import { logoutAction } from "../(auth)/actions";
import { CommandPalette, CommandTrigger } from "./command-palette";
import { ThemeToggle, TopNav, type NavItem } from "./nav";
import { endSupportViewAction, switchBranchAction } from "./shell-actions";
import { OfflineBanner, SignOutButton } from "@/components/offline";
import { OutboxSync } from "@/components/outbox-sync";
import { SwRegister } from "@/components/sw-register";

// Every screen here is per-user, per-request data; opt out of instant-navigation validation.
export const instant = false;

const NAV: (NavItem & { perm?: Permission; feature?: Feature })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", group: "Overview" },
  { href: "/alerts", label: "Alerts", icon: "BellRing", perm: "stock.view", group: "Overview" },
  { href: "/reports", label: "Reports", icon: "BarChart3", perm: "reports.view", group: "Overview" },
  { href: "/ask", label: "Ask PharmaStock", icon: "Sparkles", perm: "ai.ask", feature: "ai", group: "Overview" },
  { href: "/pos", label: "Till", icon: "ScanLine", perm: "pos.sell", group: "Counter" },
  { href: "/sales", label: "Sales", icon: "Receipt", perm: "pos.sell", group: "Counter" },
  { href: "/customers", label: "Customers", icon: "Users", perm: "customers.read", group: "Counter" },
  { href: "/prescriptions", label: "Prescriptions", icon: "FileText", perm: "prescriptions.read", feature: "prescriptions", group: "Counter" },
  { href: "/deliveries", label: "Deliveries", icon: "Bike", perm: "deliveries.manage", feature: "delivery", group: "Counter" },
  { href: "/cashup", label: "Daily close", icon: "Wallet", perm: "cashup", group: "Counter" },
  { href: "/expenses", label: "Expenses", icon: "Receipt", perm: "expenses.manage", group: "Counter" },
  { href: "/claims", label: "Insurance claims", icon: "BadgeCheck", perm: "claims.manage", feature: "claims", group: "Counter" },
  { href: "/products", label: "Products", icon: "Pill", perm: "stock.view", group: "Stock" },
  { href: "/stock", label: "Stock & batches", icon: "Boxes", perm: "stock.view", group: "Stock" },
  { href: "/transfers", label: "Transfers", icon: "ArrowLeftRight", perm: "stock.transfer", feature: "transfers", group: "Stock" },
  { href: "/register", label: "Controlled register", icon: "ShieldCheck", perm: "controlled.register", feature: "controlled", group: "Stock" },
  { href: "/purchasing", label: "Purchasing", icon: "ShoppingCart", perm: "purchasing.manage", group: "Purchasing" },
  { href: "/receiving", label: "Receive stock", icon: "PackagePlus", perm: "stock.receive", group: "Purchasing" },
  { href: "/suppliers", label: "Suppliers", icon: "Truck", perm: "purchasing.manage", group: "Purchasing" },
  { href: "/returns", label: "Supplier returns", icon: "Undo2", perm: "purchasing.manage", group: "Purchasing" },
  { href: "/messages", label: "Messages", icon: "MessageSquare", perm: "messaging.send", group: "Admin" },
  { href: "/owner", label: "Owner console", icon: "Building2", perm: "admin.console", group: "Admin" },
  { href: "/settings", label: "Settings", icon: "Settings", perm: "settings.manage", group: "Admin" },
];

const ACTIONS: { href: string; label: string; perm: Permission }[] = [
  { href: "/pos", label: "Open the till", perm: "pos.sell" },
  { href: "/receiving/new", label: "Receive a delivery", perm: "stock.receive" },
  { href: "/products/new", label: "Add a product", perm: "products.write" },
  { href: "/purchasing/reorder", label: "See what to reorder", perm: "purchasing.manage" },
  { href: "/stock/take", label: "Start a stock take", perm: "stock.take" },
  { href: "/customers/new", label: "Add a customer", perm: "customers.write" },
  { href: "/prescriptions/new", label: "Record a prescription", perm: "prescriptions.write" },
  { href: "/cashup", label: "Do today's close", perm: "cashup" },
];

const headerBtn = "grid h-8 w-8 place-items-center rounded text-on-header-muted transition-colors hover:bg-on-header/10 hover:text-on-header";

/** Top bar (sections + page tabs) with search, branch, quick sale, theme and the signed-in person on the right. */
async function Shell() {
  const ctx = await requireCtx();
  const items = NAV.filter((n) => (!n.perm || can(ctx.user.role, n.perm)) && (!n.feature || hasFeature(ctx.tenant, n.feature)))
    .map(({ href, label, icon, group }) => ({ href, label, icon, group }));
  const canSearch = (["pos.sell", "customers.read", "stock.view"] as const).some((p) => can(ctx.user.role, p));
  return (
    <>
      <TopNav items={items} pharmacy={ctx.tenant.name} right={
        <>
          <CommandTrigger canSearch={canSearch} />
          {ctx.branches.length > 1 ? (
            <form action={switchBranchAction} className="hidden items-center md:flex">
              <select name="branchId" defaultValue={ctx.branchId} aria-label="Branch"
                className="h-8 max-w-[11rem] rounded-l border border-on-header/20 bg-header px-2 text-[12px] text-on-header">
                {ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="h-8 rounded-r border border-l-0 border-on-header/20 px-2 text-[12px] text-on-header-muted hover:text-on-header">Switch</button>
            </form>
          ) : <span className="hidden text-[12px] text-on-header-muted md:inline">{ctx.branches[0]?.name}</span>}
          {can(ctx.user.role, "pos.sell") && ctx.access === "full" && (
            <Link href="/pos" className="hidden h-8 items-center gap-1.5 rounded bg-accent px-3 text-[12px] font-semibold text-on-accent hover:bg-accent-strong sm:inline-flex"><Plus className="h-3.5 w-3.5" aria-hidden /> New sale</Link>
          )}
          <ThemeToggle className={headerBtn} />
          <Link href="/account" title={`${ctx.user.name} · ${ROLE_LABELS[ctx.user.role]}`} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-on-header/10">
            <span className="grid h-7 w-7 place-items-center rounded-[4px] border border-on-header/25 font-mono text-[11px] font-semibold">{ctx.user.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}</span>
            <span className="hidden leading-tight 2xl:block">
              <span className="block max-w-[12ch] truncate text-[12px] font-medium">{ctx.user.name}</span>
              <span className="block text-[10px] text-on-header-muted">{ROLE_LABELS[ctx.user.role]}</span>
            </span>
          </Link>
          <SignOutButton action={logoutAction} className={headerBtn}>
            <LogOut className="h-4 w-4" aria-label="Sign out" />
          </SignOutButton>
        </>
      } />
      <CommandPalette pages={items} actions={ACTIONS.filter((a) => can(ctx.user.role, a.perm)).map(({ href, label }) => ({ href, label }))} canSearch={canSearch} />
    </>
  );
}

async function Banners() {
  const ctx = await requireCtx();
  const trialDays = trialDaysLeft(ctx.tenant);
  if (ctx.impersonatedBy) {
    return (
      <div className="mx-auto mt-4 max-w-[1440px] px-4 lg:px-6">
        <Callout tone="red" icon={<Eye />} actions={<form action={endSupportViewAction}><button className="rounded border border-bad/45 px-3 py-1.5 text-xs font-semibold text-bad hover:bg-bad/8">End support view</button></form>}>
          <strong>PharmaStock support view</strong> of {ctx.tenant.name} — read-only, and every page you open is logged in the pharmacy&apos;s audit trail.
        </Callout>
      </div>
    );
  }
  const show = ctx.access === "read_only" || (trialDays !== null && trialDays <= 7) || (ctx.user.role === "owner" && !ctx.user.totpEnabled);
  if (!show) return null;
  return (
    <div className="mx-auto mt-4 max-w-[1440px] space-y-2 px-4 lg:px-6">
      {ctx.access === "read_only" && (
        <Callout tone="yellow" icon={<ShieldAlert />} actions={<LinkButton href="/settings/subscription" size="sm" variant="secondary">Renew</LinkButton>}>
          Read-only mode: the subscription is unpaid. Your data is safe and you can still export everything.
        </Callout>
      )}
      {trialDays !== null && trialDays <= 7 && ctx.access === "full" && (
        <Callout tone="purple" icon={<Sparkles />} actions={can(ctx.user.role, "settings.manage") && <LinkButton href="/settings/subscription" size="sm">Choose a plan</LinkButton>}>
          {trialDays > 0 ? `${trialDays} day${trialDays === 1 ? "" : "s"} left in your free trial.` : "Your free trial has ended."}
        </Callout>
      )}
      {ctx.user.role === "owner" && !ctx.user.totpEnabled && (
        <Callout tone="blue" icon={<ShieldAlert />} actions={<LinkButton href="/account" size="sm" variant="secondary">Set up 2FA</LinkButton>}>
          Protect your pharmacy&apos;s records with two-factor authentication on your owner account.
        </Callout>
      )}
    </div>
  );
}

const PageFallback = (
  <div className="space-y-5" aria-busy="true">
    <div className="skeleton h-9 w-64" />
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>
    <div className="skeleton h-80" />
  </div>
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-bg min-h-screen text-fg print:bg-white">
      <Suspense fallback={<div className="h-12 bg-header lg:h-[88px] lg:border-b lg:border-line" />}><Shell /></Suspense>
      <OfflineBanner />
      <SwRegister />
      <OutboxSync />
      <Suspense fallback={null}><Banners /></Suspense>
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 lg:px-6 print:max-w-none print:p-0">
        <Suspense fallback={PageFallback}>{children}</Suspense>
      </main>
    </div>
  );
}
