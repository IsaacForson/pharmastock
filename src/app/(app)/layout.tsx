import { Eye, LogOut, Plus, ShieldAlert, Sparkles } from "lucide-react";
import { Avatar, Callout, LinkButton, StatusDot } from "@/components/ui";
import Link from "next/link";
import { Suspense } from "react";
import { requireCtx } from "@/lib/auth";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { hasFeature, trialDaysLeft, type Feature } from "@/lib/plans";
import { logoutAction } from "../(auth)/actions";
import { CommandPalette, CommandTrigger } from "./command-palette";
import { LogoMark, Nav, type NavItem } from "./nav";
import { endSupportViewAction, switchBranchAction } from "./shell-actions";
import { OfflineBanner, SignOutButton } from "@/components/offline";
import { OutboxSync } from "@/components/outbox-sync";
import { SwRegister } from "@/components/sw-register";

// Every screen here is per-user, per-request data; opt out of instant-navigation validation.
export const instant = false;

const NAV: (NavItem & { perm?: Permission; feature?: Feature })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", group: "Today" },
  { href: "/pos", label: "Till", icon: "ScanLine", perm: "pos.sell", group: "Today" },
  { href: "/sales", label: "Sales", icon: "Receipt", perm: "pos.sell", group: "Today" },
  { href: "/alerts", label: "Alerts", icon: "BellRing", perm: "stock.view", group: "Today" },
  { href: "/customers", label: "Customers", icon: "Users", perm: "customers.read", group: "Counter" },
  { href: "/prescriptions", label: "Prescriptions", icon: "FileText", perm: "prescriptions.read", feature: "prescriptions", group: "Counter" },
  { href: "/deliveries", label: "Deliveries", icon: "Bike", perm: "deliveries.manage", feature: "delivery", group: "Counter" },
  { href: "/products", label: "Products", icon: "Pill", perm: "stock.view", group: "Stock" },
  { href: "/stock", label: "Stock & batches", icon: "Boxes", perm: "stock.view", group: "Stock" },
  { href: "/purchasing", label: "Purchasing", icon: "ShoppingCart", perm: "purchasing.manage", group: "Stock" },
  { href: "/receiving", label: "Receive stock", icon: "PackagePlus", perm: "stock.receive", group: "Stock" },
  { href: "/suppliers", label: "Suppliers", icon: "Truck", perm: "purchasing.manage", group: "Stock" },
  { href: "/returns", label: "Supplier returns", icon: "Undo2", perm: "purchasing.manage", group: "Stock" },
  { href: "/transfers", label: "Transfers", icon: "ArrowLeftRight", perm: "stock.transfer", feature: "transfers", group: "Stock" },
  { href: "/register", label: "Controlled register", icon: "ShieldCheck", perm: "controlled.register", feature: "controlled", group: "Stock" },
  { href: "/cashup", label: "Daily close", icon: "Wallet", perm: "cashup", group: "Business" },
  { href: "/expenses", label: "Expenses", icon: "Receipt", perm: "expenses.manage", group: "Business" },
  { href: "/claims", label: "Insurance claims", icon: "BadgeCheck", perm: "claims.manage", feature: "claims", group: "Business" },
  { href: "/reports", label: "Reports", icon: "BarChart3", perm: "reports.view", group: "Business" },
  { href: "/ask", label: "Ask PharmaStock", icon: "Sparkles", perm: "ai.ask", feature: "ai", group: "Business" },
  { href: "/messages", label: "Messages", icon: "MessageSquare", perm: "messaging.send", group: "Business" },
  { href: "/owner", label: "Owner console", icon: "Building2", perm: "admin.console", group: "Business" },
  { href: "/settings", label: "Settings", icon: "Settings", perm: "settings.manage", group: "Business" },
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

async function SessionNav() {
  const ctx = await requireCtx();
  const items = NAV.filter((n) => (!n.perm || can(ctx.user.role, n.perm)) && (!n.feature || hasFeature(ctx.tenant, n.feature)))
    .map(({ href, label, icon, group }) => ({ href, label, icon, group }));
  const fullName = ctx.user.name;
  return (
    <>
      <Nav items={items} clinic={ctx.tenant.name} footer={
        <div className="space-y-2">
          {ctx.branches.length > 1 && (
            <form action={switchBranchAction} className="flex gap-1.5 lg:rail:hidden">
              <select name="branchId" defaultValue={ctx.branchId} aria-label="Branch"
                className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-2.5 text-xs text-fg">
                {ctx.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="rounded-xl border border-line bg-surface-2 px-2.5 text-xs font-medium text-fg hover:bg-surface-3">Switch</button>
            </form>
          )}
          <Link href="/account" title={fullName} className="flex items-center gap-3 rounded-2xl p-1.5 transition hover:bg-surface-2 lg:rail:justify-center">
            <Avatar name={ctx.user.name} />
            <span className="min-w-0 lg:rail:hidden">
              <span className="block truncate text-sm font-medium text-fg">{fullName}</span>
              <span className="block truncate text-[11px] text-subtle">{ROLE_LABELS[ctx.user.role]}</span>
            </span>
          </Link>
        </div>
      } />
      <CommandPalette pages={items} actions={ACTIONS.filter((a) => can(ctx.user.role, a.perm)).map(({ href, label }) => ({ href, label }))} canSearch={(["pos.sell", "customers.read", "stock.view"] as const).some((p) => can(ctx.user.role, p))} />
    </>
  );
}

async function TopBar() {
  const ctx = await requireCtx();
  const branch = ctx.branches.find((b) => b.id === ctx.branchId)?.name;
  return (
    <header className="sticky top-3 z-20 px-3 print:hidden lg:px-6">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 rounded-2xl border border-line bg-solid/70 pl-14 pr-2 shadow-panel backdrop-blur-2xl lg:pl-2">
        <CommandTrigger canSearch={(["pos.sell", "customers.read", "stock.view"] as const).some((p) => can(ctx.user.role, p))} />
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-muted md:inline-flex">
            <StatusDot tone="green" label="Online" /> {branch ?? ctx.tenant.name}
          </span>
          {can(ctx.user.role, "pos.sell") && ctx.access === "full" && (
            <LinkButton href="/pos" size="sm" className="hidden h-9 sm:inline-flex"><Plus className="h-4 w-4" aria-hidden /> New sale</LinkButton>
          )}
          <SignOutButton action={logoutAction} className="grid h-9 w-9 place-items-center rounded-xl border border-line text-muted transition hover:bg-surface-3 hover:text-fg">
            <LogOut className="h-4 w-4" aria-label="Sign out" />
          </SignOutButton>
        </div>
      </div>
    </header>
  );
}

async function Banners() {
  const ctx = await requireCtx();
  const trialDays = trialDaysLeft(ctx.tenant);
  if (ctx.impersonatedBy) {
    return (
      <div className="mx-auto mt-4 max-w-[1400px] px-3 lg:px-6">
        <Callout tone="red" icon={<Eye />} actions={<form action={endSupportViewAction}><button className="rounded-lg border border-bad/40 px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad/10">End support view</button></form>}>
          <strong>PharmaStock support view</strong> of {ctx.tenant.name} — read-only, and every page you open is logged in the pharmacy&apos;s audit trail.
        </Callout>
      </div>
    );
  }
  const show = ctx.access === "read_only" || (trialDays !== null && trialDays <= 7) || (ctx.user.role === "owner" && !ctx.user.totpEnabled);
  if (!show) return null;
  return (
    <div className="mx-auto mt-4 max-w-[1400px] space-y-2 px-3 lg:px-6">
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
  <div className="space-y-6" aria-busy="true">
    <div className="skeleton h-10 w-72" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-32 rounded-[1.25rem]" />)}</div>
    <div className="skeleton h-80 rounded-[1.25rem]" />
  </div>
);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="backdrop-os min-h-screen text-fg print:bg-white">
      <Suspense fallback={<aside className="fixed inset-y-3 left-3 hidden w-[248px] rounded-3xl border border-line bg-solid/80 lg:block lg:rail:w-[76px]"><div className="p-4"><LogoMark /></div></aside>}>
        <SessionNav />
      </Suspense>
      <div className="transition-[padding] duration-300 lg:pl-[260px] lg:rail:pl-[88px] print:pl-0">
        <OfflineBanner />
        <SwRegister />
        <OutboxSync />
        <Suspense fallback={<div className="mx-3 mt-3 h-14 rounded-2xl border border-line bg-solid/70 lg:mx-6" />}><TopBar /></Suspense>
        <Suspense fallback={null}><Banners /></Suspense>
        <main className="mx-auto max-w-[1400px] px-4 pb-16 pt-8 lg:px-8 print:max-w-none print:p-0">
          <Suspense fallback={PageFallback}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
