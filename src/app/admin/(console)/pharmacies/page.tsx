import { Building2, Search } from "lucide-react";
import Link from "next/link";
import { Avatar, Badge, Callout, Input, PageHeader, Panel, Table, Tabs, Td } from "@/components/ui";
import { dateOnly, money } from "@/lib/format";
import { requireAdmin } from "@/lib/platform-auth";
import { deletionRequests, listPharmacies, pharmacyMrr } from "@/lib/platform-metrics";
import { controlMoney } from "../money";
import { PLANS } from "@/lib/plans";

export const metadata = { title: "Pharmacies" };

const STATUS_TONE = { active: "green", trialing: "purple", past_due: "yellow", read_only: "red", cancelled: "gray", suspended: "red" } as const;
const ago = (d: string | null) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

export default async function PharmaciesPage({ searchParams }: PageProps<"/admin/pharmacies">) {
  const { admin } = await requireAdmin();
  const { m, fmt, display } = await controlMoney(admin);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const deletions = await deletionRequests();
  const deletionIds = new Set(deletions.map((d) => d.tenantId));
  const rows = status === "deletion"
    ? (await listPharmacies({ q, limit: 500 })).filter((r) => deletionIds.has(r.id))
    : await listPharmacies({ q, status: status || undefined, limit: 50, offset: (page - 1) * 50 });
  const href = (o: Record<string, string>) => `/admin/pharmacies?${new URLSearchParams({ ...(q ? { q } : {}), ...o })}`;
  return (
    <>
      <PageHeader eyebrow="Customers" icon={<Building2 />} title="Pharmacies" subtitle="Every pharmacy on PharmaStock. Open one to manage its subscription, support it or handle a deletion request." />
      {sp.deleted && <div className="mb-4"><Callout tone="green">Pharmacy deleted. Its audit trail is kept.</Callout></div>}
      <form className="mb-4 flex max-w-xl items-center gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" /><Input name="q" defaultValue={q} placeholder="Search name, owner email or phone…" className="pl-10" /></div>
      </form>
      <Tabs current={status || "all"} tabs={[
        { key: "all", label: "All", href: href({}) }, { key: "active", label: "Paying", href: href({ status: "active" }) },
        { key: "trialing", label: "Trial", href: href({ status: "trialing" }) }, { key: "past_due", label: "Past due", href: href({ status: "past_due" }) },
        { key: "read_only", label: "Read-only", href: href({ status: "read_only" }) }, { key: "suspended", label: "Suspended", href: href({ status: "suspended" }) },
        { key: "deletion", label: "Deletion requests", href: href({ status: "deletion" }), count: deletions.length },
      ]} />
      <Panel>
        <Table head={["Pharmacy", "Owner", "Plan", "Status", `MRR (${display})`, "Staff", "Branches", "Products", "Last active", "Joined"]} empty={q ? "No pharmacies match." : "No pharmacies here."}>
          {rows.map((c) => {
            const st = c.suspendedAt ? "suspended" : c.planStatus;
            return (
              <tr key={c.id}>
                <Td>
                  <Link href={`/admin/pharmacies/${c.id}`} className="flex items-center gap-3 font-medium hover:text-accent">
                    <Avatar name={c.name} size="sm" /><span><span className="block">{c.name}</span><span className="block text-xs font-normal text-subtle">{c.country} · {c.currency}</span></span>
                  </Link>
                </Td>
                <Td className="text-sm"><span className="block">{c.ownerName}</span><span className="block text-xs text-subtle">{c.ownerEmail ?? c.ownerPhone}</span></Td>
                <Td>{PLANS[c.plan].name}{c.plan === "chain" && <span className="text-xs text-subtle"> · {c.billedBranches} branches</span>}{c.billingCycle === "annual" && <span className="text-xs text-subtle"> · annual</span>}</Td>
                <Td><Badge tone={STATUS_TONE[st as keyof typeof STATUS_TONE] ?? "gray"}>{st.replace("_", " ")}</Badge>{deletionIds.has(c.id) && <span className="ml-1"><Badge tone="yellow">deletion</Badge></span>}</Td>
                <Td className="tabular-nums" title={money(pharmacyMrr(m, c).local, c.currency)}>{fmt(pharmacyMrr(m, c).display)}</Td>
                <Td className="tabular-nums">{c.users}</Td>
                <Td className="tabular-nums">{c.branches}</Td>
                <Td className="tabular-nums">{c.products.toLocaleString()}</Td>
                <Td className="text-muted">{ago(c.lastActive)}</Td>
                <Td className="text-muted">{dateOnly(c.createdAt, "UTC")}</Td>
              </tr>
            );
          })}
        </Table>
        {status !== "deletion" && (rows.length === 50 || page > 1) && (
          <div className="mt-4 flex justify-between text-sm">
            {page > 1 ? <Link href={href({ ...(status ? { status } : {}), page: String(page - 1) })} className="text-accent">← Previous</Link> : <span />}
            {rows.length === 50 && <Link href={href({ ...(status ? { status } : {}), page: String(page + 1) })} className="text-accent">Next →</Link>}
          </div>
        )}
      </Panel>
    </>
  );
}
