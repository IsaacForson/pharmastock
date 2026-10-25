import { outer } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { ClipboardCheck, ScanLine } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { A, Badge, Callout, Field, Input, LinkButton, PageHeader, Panel, Select, Table, Td } from "@/components/ui";
import { products, stockTakeLines, stockTakes, users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { startTakeAction } from "./actions";

export const metadata = { title: "Stock take" };

const STATUS = { open: { tone: "blue", word: "Counting" }, completed: { tone: "green", word: "Completed" }, cancelled: { tone: "gray", word: "Cancelled" } } as const;

export default async function StockTakesPage({ searchParams }: PageProps<"/stock/take">) {
  const ctx = await requireCtx("stock.take");
  const sp = await searchParams;
  const productId = typeof sp.product === "string" && /^[0-9a-f-]{36}$/i.test(sp.product) ? sp.product : null;
  const { rows, product } = await tx(ctx, async (t) => ({
    rows: await t.select({ take: stockTakes, by: users.name, lines: sql<number>`(select count(*)::int from ${stockTakeLines} where ${stockTakeLines.takeId} = ${outer(stockTakes.id)})` })
      .from(stockTakes).leftJoin(users, eq(users.id, stockTakes.startedBy)).where(eq(stockTakes.branchId, ctx.branchId))
      .orderBy(desc(stockTakes.startedAt)).limit(100),
    product: productId ? (await t.select({ id: products.id, name: products.name, strength: products.strength }).from(products).where(eq(products.id, productId)))[0] : undefined,
  }));
  const open = rows.filter((r) => r.take.status === "open");
  const tz = ctx.tenant.timezone;

  return (
    <>
      <PageHeader icon={<ClipboardCheck />} eyebrow="Stock" title="Stock take" subtitle="Count what's on the shelf and fix the books. Scan, count, done." />

      {product && (
        <div className="mb-6">
          <Callout tone="blue" icon={<ScanLine />} actions={open[0] && <LinkButton size="sm" href={`/stock/take/${open[0].take.id}?product=${product.id}`}>Count in {open[0].take.takeNo}</LinkButton>}>
            Count <strong>{[product.name, product.strength].filter(Boolean).join(" ")}</strong>{open[0] ? " in the open stock take, or start a quick partial count below." : ": start a quick partial count below."}
          </Callout>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Panel title="Stock takes at this branch" eyebrow={`${open.length} open`}>
          <Table head={["No.", "Type", "Status", "Started", "Lines", ""]} empty="No stock takes yet. Start one on the right.">
            {rows.map(({ take, by, lines }) => (
              <tr key={take.id}>
                <Td><A href={`/stock/take/${take.id}`} className="font-mono text-xs">{take.takeNo}</A></Td>
                <Td className="capitalize">{take.scope}</Td>
                <Td><Badge tone={STATUS[take.status as keyof typeof STATUS]?.tone ?? "gray"}>{STATUS[take.status as keyof typeof STATUS]?.word ?? take.status}</Badge></Td>
                <Td className="text-muted">{dateTime(take.startedAt, tz)}{by ? ` · ${by}` : ""}</Td>
                <Td className="tabular-nums">{lines}</Td>
                <Td className="text-right">
                  {take.status === "open" ? <LinkButton size="sm" href={`/stock/take/${take.id}`}>Continue</LinkButton> : <A href={`/stock/take/${take.id}/report`}>Report</A>}
                </Td>
              </tr>
            ))}
          </Table>
        </Panel>

        <Panel title="Start a count" icon={<ScanLine />} glow className="h-fit lg:sticky lg:top-24">
          <ActionForm action={startTakeAction} onSuccessHref="/stock/take/{id}">
            {product && <input type="hidden" name="product" value={product.id} />}
            <Field label="What are you counting?" hint="Partial: only what you count is corrected. Full: anything not counted is treated as missing (you'll confirm first).">
              <Select name="scope" defaultValue={product ? "partial" : "full"}>
                <option value="partial">Partial count (some shelves or products)</option>
                <option value="full">Full count (whole branch)</option>
              </Select>
            </Field>
            <Field label="Note (optional)"><Input name="notes" placeholder="e.g. Shelf A, end of month" defaultValue={product ? `Count ${product.name}` : undefined} /></Field>
            <div className="flex justify-end"><Submit>Start counting</Submit></div>
          </ActionForm>
        </Panel>
      </div>
    </>
  );
}
