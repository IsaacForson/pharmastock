import { and, desc, eq, type SQL } from "drizzle-orm";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import { Badge, Button, PageHeader, Panel, Select, Table, Td } from "@/components/ui";
import { adminDb } from "@/db";
import { platformAdmins, platformAudit, tenants } from "@/db/schema";
import { dateTime } from "@/lib/format";
import { requireAdmin } from "@/lib/platform-auth";

export const metadata = { title: "Audit log" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin();
  const sp = await searchParams;
  const adminId = typeof sp.admin === "string" && /^[0-9a-f-]{36}$/.test(sp.admin) ? sp.admin : null;
  const tenantId = typeof sp.pharmacy === "string" && /^[0-9a-f-]{36}$/.test(sp.pharmacy) ? sp.pharmacy : null;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: SQL[] = [];
  if (adminId) where.push(eq(platformAudit.adminId, adminId));
  if (tenantId) where.push(eq(platformAudit.tenantId, tenantId));
  const db = adminDb();
  const [rows, admins] = await Promise.all([
    db.select({ l: platformAudit, by: platformAdmins.name, pharmacy: tenants.name }).from(platformAudit)
      .leftJoin(platformAdmins, eq(platformAdmins.id, platformAudit.adminId)).leftJoin(tenants, eq(tenants.id, platformAudit.tenantId))
      .where(where.length ? and(...where) : undefined).orderBy(desc(platformAudit.at)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ id: platformAdmins.id, name: platformAdmins.name }).from(platformAdmins).orderBy(platformAdmins.name),
  ]);
  const tone = (a: string) => a.includes("delete") || a.includes("suspend") || a.includes("failed") ? "red" : a.includes("support") ? "yellow" : a.includes("billing") || a.includes("trial") ? "green" : "gray";
  const qs = (o: Record<string, string>) => `/admin/audit?${new URLSearchParams({ ...(adminId ? { admin: adminId } : {}), ...(tenantId ? { pharmacy: tenantId } : {}), ...o })}`;
  return (
    <>
      <PageHeader eyebrow="Accountability" icon={<ScrollText />} title="Audit log" subtitle="Every sign-in and action by the PharmaStock team. Append-only — entries can't be edited or deleted." />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        <Select name="admin" defaultValue={adminId ?? ""} className="w-56"><option value="">All team members</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        {tenantId && <input type="hidden" name="pharmacy" value={tenantId} />}
        <Button variant="secondary" type="submit">Filter</Button>
        {(adminId || tenantId) && <Link href="/admin/audit" className="text-sm text-muted hover:text-fg">Clear</Link>}
      </form>
      <Panel>
        <Table head={["When", "Team member", "Action", "Pharmacy", "Details", "IP"]} empty="Nothing logged yet.">
          {rows.map(({ l, by, pharmacy }) => (
            <tr key={l.id}>
              <Td className="text-muted">{dateTime(l.at, "UTC")}</Td>
              <Td>{by ?? <span className="text-subtle">system / CLI</span>}</Td>
              <Td><Badge tone={tone(l.action)}>{l.action.replaceAll("_", " ")}</Badge></Td>
              <Td>{l.tenantId ? <Link href={`/admin/pharmacies/${l.tenantId}`} className="hover:text-accent">{pharmacy ?? "deleted"}</Link> : <span className="text-subtle">—</span>}</Td>
              <Td className="max-w-md truncate font-mono text-[11px] text-subtle" title={l.details ? JSON.stringify(l.details) : ""}>{l.details ? JSON.stringify(l.details) : ""}</Td>
              <Td className="font-mono text-xs text-subtle">{l.ip}</Td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex justify-between text-sm">
          {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="text-accent">← Newer</Link> : <span />}
          {rows.length === PAGE && <Link href={qs({ page: String(page + 1) })} className="text-accent">Older →</Link>}
        </div>
      </Panel>
    </>
  );
}
