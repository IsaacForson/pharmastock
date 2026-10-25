import { outer } from "@/db";
import { aliasedTable, and, desc, eq, or, sql } from "drizzle-orm";
import { ArrowLeftRight, Plus } from "lucide-react";
import { A, Badge, LinkButton, PageHeader, Panel, Table, Tabs, Td, type Tone } from "@/components/ui";
import { branches, transferLines, transfers } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { ChainOnly } from "./chain-only";

export const metadata = { title: "Transfers" };
const STATUS: Record<string, { label: string; tone: Tone }> = {
  in_transit: { label: "In transit", tone: "yellow" }, received: { label: "Received", tone: "green" }, cancelled: { label: "Cancelled", tone: "gray" },
};

export default async function TransfersPage({ searchParams }: PageProps<"/transfers">) {
  const ctx = await requireCtx("stock.transfer");
  if (!hasFeature(ctx.tenant, "transfers")) return <ChainOnly />;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && sp.status in STATUS ? sp.status : "in_transit";
  const from = aliasedTable(branches, "from_b"), to = aliasedTable(branches, "to_b");
  const here = or(eq(transfers.fromBranchId, ctx.branchId), eq(transfers.toBranchId, ctx.branchId));
  const { rows, counts } = await tx(ctx, async (t) => {
    const rows = await t.select({
      tr: transfers, fromName: from.name, toName: to.name,
      lines: sql<number>`(select count(*)::int from ${transferLines} where ${transferLines.transferId} = ${outer(transfers.id)})`,
    }).from(transfers).innerJoin(from, eq(from.id, transfers.fromBranchId)).innerJoin(to, eq(to.id, transfers.toBranchId))
      .where(and(here, eq(transfers.status, status))).orderBy(desc(transfers.sentAt)).limit(200);
    const counts = await t.select({ status: transfers.status, n: sql<number>`count(*)::int` }).from(transfers).where(here).groupBy(transfers.status);
    return { rows, counts };
  });
  const n = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
  const tz = ctx.tenant.timezone;
  return (
    <>
      <PageHeader title="Transfers" eyebrow="Stock" icon={<ArrowLeftRight />} subtitle={`${n("in_transit")} on the way to or from this branch`}
        actions={<LinkButton href="/transfers/new"><Plus className="h-4 w-4" aria-hidden /> Send stock</LinkButton>} />
      <Tabs current={status} tabs={Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, href: `/transfers?status=${k}`, count: n(k) }))} />
      <Panel>
        <Table head={["Transfer", "Direction", "From", "To", "Items", "Sent", status === "received" ? "Received" : "Status"]} empty="No transfers here">
          {rows.map((r) => {
            const out = r.tr.fromBranchId === ctx.branchId;
            return (
              <tr key={r.tr.id}>
                <Td><A href={`/transfers/${r.tr.id}`} className="font-mono text-xs">{r.tr.transferNo}</A></Td>
                <Td><Badge tone={out ? "purple" : "teal"}>{out ? "Outgoing" : "Incoming"}</Badge></Td>
                <Td>{r.fromName}</Td>
                <Td>{r.toName}</Td>
                <Td className="tabular-nums">{r.lines}</Td>
                <Td className="text-muted">{dateTime(r.tr.sentAt, tz)}</Td>
                <Td>{status === "received" ? <span className="text-muted">{dateTime(r.tr.receivedAt, tz)}</span> : <Badge tone={STATUS[r.tr.status].tone}>{STATUS[r.tr.status].label}</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
      </Panel>
    </>
  );
}
