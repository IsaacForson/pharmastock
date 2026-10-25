import { outer } from "@/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { A, Badge, Callout, EmptyState, Input, Panel, PageHeader, Table, Td, Toolbar } from "@/components/ui";
import { controlledRegister, products, stockBatches } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { rulesFor } from "@/lib/compliance";
import { hasFeature } from "@/lib/plans";

export const metadata = { title: "Controlled register" };

export default async function RegisterIndex({ searchParams }: PageProps<"/register">) {
  const ctx = await requireCtx("controlled.register");
  const rules = rulesFor(ctx.tenant.country);
  if (!hasFeature(ctx.tenant, "controlled")) {
    return (
      <>
        <PageHeader icon={<ShieldCheck />} eyebrow="Compliance" title="Controlled register" />
        <Callout tone="blue">The controlled-drug register is on the Pro and Chain plans. <A href="/settings/subscription">See plans</A></Callout>
      </>
    );
  }
  const q = String((await searchParams).q ?? "").trim();
  const rows = await tx(ctx, (t) => t.select({
    id: products.id, name: products.name, strength: products.strength, form: products.form, baseUnit: products.baseUnit,
    onHand: sql<number>`coalesce((select sum(${stockBatches.qtyOnHand}) from ${stockBatches} where ${stockBatches.productId} = ${outer(products.id)} and ${stockBatches.branchId} = ${ctx.branchId}), 0)::int`,
    balance: sql<number | null>`(select ${controlledRegister.balance} from ${controlledRegister} where ${controlledRegister.productId} = ${outer(products.id)} and ${controlledRegister.branchId} = ${ctx.branchId} order by ${controlledRegister.entryNo} desc limit 1)`,
    entries: sql<number>`(select count(*) from ${controlledRegister} where ${controlledRegister.productId} = ${outer(products.id)} and ${controlledRegister.branchId} = ${ctx.branchId})::int`,
  }).from(products)
    .where(and(eq(products.schedule, "controlled"), q ? sql`${products.name} ilike ${"%" + q + "%"}` : undefined))
    .orderBy(asc(products.name)));
  const off = rows.filter((r) => (r.balance ?? 0) !== r.onHand);

  return (
    <>
      <PageHeader icon={<ShieldCheck />} eyebrow="Compliance" title={rules.registerTitle}
        subtitle={`${rows.length} controlled products · ${ctx.branches.find((b) => b.id === ctx.branchId)?.name ?? ""}`} />
      {off.length > 0 && (
        <div className="mb-6">
          <Callout tone="red" icon={<TriangleAlert />}>
            {off.length} product{off.length > 1 ? "s" : ""} where the register balance doesn&apos;t match stock. Count them and record a correction.
          </Callout>
        </div>
      )}
      <form><Toolbar><Input name="q" defaultValue={q} placeholder="Search controlled products" className="max-w-xs" /></Toolbar></form>
      <Panel>
        {rows.length === 0 ? (
          <EmptyState icon={<ShieldCheck />} title="No controlled products yet">Set a product&apos;s schedule to &quot;Controlled drug&quot; and its movements are recorded here automatically.</EmptyState>
        ) : (
          <Table head={["Product", "Register balance", "In stock", "Entries", "Status"]}>
            {rows.map((r) => {
              const ok = (r.balance ?? 0) === r.onHand;
              return (
                <tr key={r.id}>
                  <Td><A href={`/register/${r.id}`}>{r.name}</A> <span className="text-xs text-muted">{[r.strength, r.form].filter(Boolean).join(" · ")}</span></Td>
                  <Td className="tabular-nums">{r.balance ?? 0} {r.baseUnit}</Td>
                  <Td className="tabular-nums">{r.onHand} {r.baseUnit}</Td>
                  <Td className="tabular-nums text-muted">{r.entries}</Td>
                  <Td>{ok ? <Badge tone="green">Balanced</Badge> : <Badge tone="red" pulse>Off by {r.onHand - (r.balance ?? 0)}</Badge>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>
    </>
  );
}
