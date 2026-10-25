/**
 * "Ask PharmaStock": business questions in plain language, answered by an LLM on Groq (OpenAI-compatible chat API,
 * free tier) using READ-ONLY, tenant-scoped query tools (RLS via withTenant; branch scope decided by the caller).
 * No dosing or clinical advice: the system prompt restricts the model to stock and business questions. Manual tool loop
 * so we can cap turns, report progress and audit tool use.
 */
import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import { deadStock, priceImpact } from "./analytics";
import { addDays, dayRange, money } from "./format";
import { reorderSuggestions } from "./reorder";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
/** Override with GROQ_MODEL; any Groq model with tool use works. */
export const aiModel = () => process.env.GROQ_MODEL || "openai/gpt-oss-120b";
export const MAX_TURNS = 6; // tool rounds before we stop and answer with what we have
export const MAX_QUESTION = 500;
export const aiConfigured = () => !!process.env.GROQ_API_KEY;

export type AskScope = {
  tenant: { id: string; name: string; timezone: string; currency: string; reorderCoverDays: number; country: string };
  branches: { id: string; name: string }[]; // branches the answer may cover
  canSeeCost: boolean; // reports.margin
  today: string;
};

const SYSTEM = `You are "Ask PharmaStock", the business assistant inside a pharmacy's stock and point-of-sale system.
You answer questions about this pharmacy's sales, stock, expiry, reordering, margins, suppliers and prices, using only the tools provided. They return live data for this pharmacy; never invent figures.
Rules:
- Stay on business and stock questions. Do not give dosing, drug interaction, diagnosis or other clinical advice; if asked, say a pharmacist should advise and offer a stock or sales angle instead.
- Money values from tools are already formatted in the pharmacy's currency. Quantities are in base units (tablets, bottles) unless a pack is named.
- If a tool says cost data is not available to this user, answer without margins and say so.
- Be brief and practical: lead with the answer, then a short list or table (Markdown) of the items that matter, then one suggested next step if useful. Mention the dates the figures cover.`;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SCHEMAS = {
  reorder_list: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  expiring_batches: z.object({ within_days: z.number().int().min(0).max(730), include_expired: z.boolean().optional() }),
  sales_by_product: z.object({ product: z.string().max(80).optional(), from: dateStr, to: dateStr, limit: z.number().int().min(1).max(50).optional() }),
  sales_by_day: z.object({ product: z.string().max(80).optional(), from: dateStr, to: dateStr }),
  stock_on_hand: z.object({ product: z.string().min(1).max(80) }),
  dead_stock: z.object({ days_without_sales: z.number().int().min(7).max(730) }),
  price_changes: z.object({ product: z.string().max(80).optional(), since: dateStr.optional() }),
} as const;
type ToolName = keyof typeof SCHEMAS;

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false });
const D = { type: "string", description: "YYYY-MM-DD, pharmacy local date" };
const P = { type: "string", description: "Part of a brand or generic name, e.g. 'paracetamol'" };
const fn = (name: string, description: string, parameters: ReturnType<typeof obj>) => ({ type: "function" as const, function: { name, description, parameters } });
export const TOOLS = [
  fn("reorder_list", "Items to reorder now: stock on hand, days of cover, suggested order quantity and supplier. Use for 'what should I reorder'.", obj({ limit: { type: "integer" } }, [])),
  fn("expiring_batches", "Batches expiring within N days (optionally also already expired ones still on the shelf) with quantity and value at cost.", obj({ within_days: { type: "integer" }, include_expired: { type: "boolean" } }, ["within_days"])),
  fn("sales_by_product", "Units sold, revenue (ex tax, after returns) and margin per product for a date range, best sellers first. Optional product name filter.", obj({ product: P, from: D, to: D, limit: { type: "integer" } }, ["from", "to"])),
  fn("sales_by_day", "Daily units and revenue for a date range, optionally for one product. Use for trends.", obj({ product: P, from: D, to: D }, ["from", "to"])),
  fn("stock_on_hand", "Current stock for products matching a name: per branch, sellable vs expired/quarantined, value, nearest expiry.", obj({ product: P }, ["product"])),
  fn("dead_stock", "Products holding stock with no sales in the last N days, with value tied up.", obj({ days_without_sales: { type: "integer" } }, ["days_without_sales"])),
  fn("price_changes", "Selling price changes and their impact: units/day and margin/day in the 30 days before vs after each change.", obj({ product: P, since: D }, [])),
];

type R = Record<string, unknown>;
const q = async <T extends R>(t: Tx, s: SQL) => (await t.execute(s)) as unknown as T[];
const KEPT = sql`((sl.base_qty - sl.returned_base_qty)::numeric / nullif(sl.base_qty, 0))`;
const like = (p?: string) => (p ? `%${p.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null);
const nameMatch = (p?: string) => (p ? sql`and (p.name ilike ${like(p)} or p.generic_name ilike ${like(p)})` : sql``);

/** Runs one tool. Pure reads inside the caller's RLS transaction. Returns JSON-able data for the model. */
export async function runTool(t: Tx, s: AskScope, name: string, raw: unknown): Promise<unknown> {
  if (!(name in SCHEMAS)) return { error: `Unknown tool ${name}` };
  const input = SCHEMAS[name as ToolName].parse(raw) as unknown;
  const B = s.branches.map((b) => b.id);
  const m = (v: unknown) => money(Math.round(Number(v ?? 0)), s.tenant.currency);
  const tz = s.tenant.timezone;
  const range = (from: string, to: string) => ({ start: dayRange(from, tz).start.toISOString(), end: dayRange(to, tz).end.toISOString() });
  const branchName = (id: unknown) => s.branches.find((b) => b.id === id)?.name ?? "";
  switch (name as ToolName) {
    case "reorder_list": {
      const { limit = 20 } = input as z.infer<typeof SCHEMAS.reorder_list>;
      const all = [];
      for (const b of s.branches) for (const r of await reorderSuggestions(t, { tenant: s.tenant, branchId: b.id })) all.push({ ...r, branch: b.name });
      return all.sort((a, b) => (a.daysOfCover ?? -1) - (b.daysOfCover ?? -1)).slice(0, limit).map((r) => ({
        product: `${r.name}${r.strength ? ` ${r.strength}` : ""}`, branch: s.branches.length > 1 ? r.branch : undefined, onHand: r.onHand, onOrder: r.onOrder,
        dailySales: Math.round(r.dailyDemand * 10) / 10, daysOfCover: r.daysOfCover === null ? null : Math.floor(r.daysOfCover), why: r.reason.replace(/_/g, " "),
        order: `${r.packs} × ${r.unitName}`, supplier: r.supplierName, estimatedCost: s.canSeeCost && r.estCostMinor !== null ? m(r.estCostMinor) : undefined,
      }));
    }
    case "expiring_batches": {
      const { within_days, include_expired } = input as z.infer<typeof SCHEMAS.expiring_batches>;
      const rows = await q(t, sql`select p.name || coalesce(' ' || p.strength, '') as product, b.branch_id, nullif(b.batch_no, '') as batch, b.expiry::text as expiry,
          (b.expiry - ${s.today}::date)::int as days_left, b.qty_on_hand as qty, b.qty_on_hand * b.unit_cost_minor as value, b.quarantined, sup.name as supplier
        from stock_batches b join products p on p.id = b.product_id left join suppliers sup on sup.id = b.supplier_id
        where b.qty_on_hand > 0 and b.branch_id in ${B} and b.expiry <= ${addDays(s.today, within_days)} ${include_expired ? sql`` : sql`and b.expiry >= ${s.today}`}
        order by b.expiry limit 100`);
      return rows.map((r) => ({ ...r, branch_id: undefined, branch: s.branches.length > 1 ? branchName(r.branch_id) : undefined, value: s.canSeeCost ? m(r.value) : undefined }));
    }
    case "sales_by_product": {
      const { product, from, to, limit = 20 } = input as z.infer<typeof SCHEMAS.sales_by_product>;
      const r = range(from, to);
      const rows = await q(t, sql`select p.name || coalesce(' ' || p.strength, '') as product, sum(sl.base_qty - sl.returned_base_qty)::int as units,
          round(sum((sl.total_minor - sl.tax_minor) * ${KEPT})) as revenue, round(sum(sl.cost_minor * ${KEPT})) as cost
        from sale_lines sl join sales s on s.id = sl.sale_id join products p on p.id = sl.product_id
        where s.status <> 'voided' and s.branch_id in ${B} and s.sold_at >= ${r.start} and s.sold_at < ${r.end} ${nameMatch(product)}
        group by p.id, p.name, p.strength order by 3 desc limit ${limit}`);
      return { from, to, rows: rows.map((x) => ({ product: x.product, units: x.units, revenue: m(x.revenue), ...(s.canSeeCost ? { margin: m(Number(x.revenue) - Number(x.cost)) } : {}) })), ...(s.canSeeCost ? {} : { note: "Cost and margin are not available to this user." }) };
    }
    case "sales_by_day": {
      const { product, from, to } = input as z.infer<typeof SCHEMAS.sales_by_day>;
      const r = range(from, to);
      const rows = await q(t, sql`select (s.sold_at at time zone ${tz})::date::text as day, sum(sl.base_qty - sl.returned_base_qty)::int as units, round(sum((sl.total_minor - sl.tax_minor) * ${KEPT})) as revenue
        from sale_lines sl join sales s on s.id = sl.sale_id join products p on p.id = sl.product_id
        where s.status <> 'voided' and s.branch_id in ${B} and s.sold_at >= ${r.start} and s.sold_at < ${r.end} ${nameMatch(product)} group by 1 order by 1 limit 400`);
      return { from, to, product: product ?? "all products", days: rows.map((x) => ({ day: x.day, units: x.units, revenue: m(x.revenue) })) };
    }
    case "stock_on_hand": {
      const { product } = input as z.infer<typeof SCHEMAS.stock_on_hand>;
      const rows = await q(t, sql`select p.name || coalesce(' ' || p.strength, '') as product, p.base_unit as unit, b.branch_id,
          coalesce(sum(b.qty_on_hand) filter (where not b.quarantined and (b.expiry is null or b.expiry >= ${s.today})), 0)::int as sellable,
          coalesce(sum(b.qty_on_hand) filter (where b.quarantined or b.expiry < ${s.today}), 0)::int as blocked,
          sum(b.qty_on_hand * b.unit_cost_minor) as value, min(b.expiry) filter (where b.qty_on_hand > 0 and b.expiry >= ${s.today})::text as next_expiry
        from products p join stock_batches b on b.product_id = p.id and b.branch_id in ${B}
        where p.active ${nameMatch(product)} group by p.id, p.name, p.strength, p.base_unit, b.branch_id order by 1 limit 50`);
      if (!rows.length) return { result: `No product matching "${product}" has stock records.` };
      return rows.map((r) => ({ product: r.product, unit: r.unit, branch: s.branches.length > 1 ? branchName(r.branch_id) : undefined, sellable: r.sellable, expiredOrQuarantined: r.blocked, nextExpiry: r.next_expiry, value: s.canSeeCost ? m(r.value) : undefined }));
    }
    case "dead_stock": {
      const { days_without_sales } = input as z.infer<typeof SCHEMAS.dead_stock>;
      const rows = await q<{ product: string; onHand: number; value: number; lastSoldAt: string | null; firstReceivedAt: string | null }>(t, sql`
        select p.name || coalesce(' ' || p.strength, '') as product, sum(b.qty_on_hand)::int as "onHand", sum(b.qty_on_hand * b.unit_cost_minor)::float8 as value,
          to_char((select max(s.sold_at) from sale_lines sl join sales s on s.id = sl.sale_id where sl.product_id = p.id and s.status <> 'voided' and s.branch_id in ${B}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastSoldAt",
          to_char(min(b.received_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "firstReceivedAt"
        from stock_batches b join products p on p.id = b.product_id where b.qty_on_hand > 0 and b.branch_id in ${B} group by p.id, p.name, p.strength`);
      return deadStock(rows, dayRange(addDays(s.today, -days_without_sales), tz).start).slice(0, 40)
        .map((r) => ({ product: r.product, onHand: r.onHand, lastSold: r.lastSoldAt?.slice(0, 10) ?? "never", value: s.canSeeCost ? m(r.value) : undefined }));
    }
    case "price_changes": {
      const { product, since } = input as z.infer<typeof SCHEMAS.price_changes>;
      const changes = await q<{ productId: string; product: string; unit: string; oldPrice: number; newPrice: number; at: string }>(t, sql`
        select pc.product_id as "productId", p.name || coalesce(' ' || p.strength, '') as product, u.name as unit, pc.old_price_minor as "oldPrice", pc.new_price_minor as "newPrice",
          to_char(pc.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
        from price_changes pc join products p on p.id = pc.product_id join product_units u on u.id = pc.unit_id
        where pc.created_at >= ${dayRange(since ?? addDays(s.today, -365), tz).start.toISOString()} ${nameMatch(product)} order by pc.created_at desc limit 10`);
      const out = [];
      for (const c of changes) {
        const at = new Date(c.at), to = new Date(Math.min(at.getTime() + 30 * 86400_000, Date.now()));
        const [w] = await q<{ ub: number; rb: number; cb: number; ua: number; ra: number; ca: number }>(t, sql`select
            coalesce(sum(sl.base_qty - sl.returned_base_qty) filter (where s.sold_at < ${c.at}), 0)::int as ub, coalesce(sum((sl.total_minor - sl.tax_minor) * ${KEPT}) filter (where s.sold_at < ${c.at}), 0)::float8 as rb,
            coalesce(sum(sl.cost_minor * ${KEPT}) filter (where s.sold_at < ${c.at}), 0)::float8 as cb,
            coalesce(sum(sl.base_qty - sl.returned_base_qty) filter (where s.sold_at >= ${c.at}), 0)::int as ua, coalesce(sum((sl.total_minor - sl.tax_minor) * ${KEPT}) filter (where s.sold_at >= ${c.at}), 0)::float8 as ra,
            coalesce(sum(sl.cost_minor * ${KEPT}) filter (where s.sold_at >= ${c.at}), 0)::float8 as ca
          from sale_lines sl join sales s on s.id = sl.sale_id
          where sl.product_id = ${c.productId} and s.status <> 'voided' and s.branch_id in ${B} and s.sold_at >= ${new Date(at.getTime() - 30 * 86400_000).toISOString()} and s.sold_at < ${to.toISOString()}`);
        const r = priceImpact({ units: w.ub, revenue: w.rb, cost: w.cb, days: 30 }, { units: w.ua, revenue: w.ra, cost: w.ca, days: Math.max((to.getTime() - at.getTime()) / 86400_000, 1) });
        out.push({ product: c.product, pack: c.unit, changedOn: c.at.slice(0, 10), oldPrice: m(c.oldPrice), newPrice: m(c.newPrice), unitsPerDayBefore: r.unitsPerDayBefore, unitsPerDayAfter: r.unitsPerDayAfter, unitsChangePct: r.unitsChangePct,
          ...(s.canSeeCost ? { marginPerDayBefore: m(r.marginPerDayBefore), marginPerDayAfter: m(r.marginPerDayAfter) } : {}) });
      }
      return out.length ? out : { result: "No price changes found for that." };
    }
  }
}

export type AskEvent = { type: "tool"; label: string } | { type: "answer"; text: string } | { type: "error"; message: string };
const LABEL: Record<string, string> = {
  reorder_list: "Checking the reorder list", expiring_batches: "Looking at expiry dates", sales_by_product: "Adding up sales by product",
  sales_by_day: "Looking at daily sales", stock_on_hand: "Checking stock on hand", dead_stock: "Finding slow-moving stock", price_changes: "Comparing sales before and after price changes",
};

// OpenAI-style chat messages, as Groq takes and returns them.
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };
export type ChatRequest = { model: string; messages: ChatMessage[]; tools: typeof TOOLS; tool_choice: "auto" | "none"; max_tokens: number; temperature: number };
export type ChatResponse = { choices: { finish_reason: string; message: { content: string | null; tool_calls?: ToolCall[] } }[] };
export type Chat = (req: ChatRequest) => Promise<ChatResponse>;

/** Calls Groq's chat completions endpoint. Errors carry Groq's message (rate limit, bad key) for the server log. */
export const groqChat: Chat = async (req) => {
  const res = await fetch(GROQ_URL, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(req), signal: AbortSignal.timeout(60_000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Groq ${res.status}: ${json?.error?.message ?? res.statusText}`);
  return json as ChatResponse;
};

/**
 * The tool loop. `read` runs a callback in a fresh RLS transaction (one per tool round, so no transaction is held open
 * while waiting on the model). Emits progress events; returns the tool names used (for the audit log).
 */
export async function ask(question: string, s: AskScope, read: <T>(fn: (t: Tx) => Promise<T>) => Promise<T>, emit: (e: AskEvent) => void, chat: Chat = groqChat) {
  const used: string[] = [];
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Pharmacy: ${s.tenant.name} (${s.tenant.country}). Currency: ${s.tenant.currency}. Today: ${s.today}. Branches covered: ${s.branches.map((b) => b.name).join(", ")}.\n\nQuestion: ${question}` },
  ];
  for (let turn = 0; turn <= MAX_TURNS; turn++) {
    const res = await chat({
      model: aiModel(), messages, tools: TOOLS, tool_choice: turn < MAX_TURNS ? "auto" : "none", // last round: answer with what we have
      max_tokens: 4000, temperature: 0.2,
    });
    const msg = res.choices?.[0]?.message;
    const calls = msg?.tool_calls ?? [];
    if (!calls.length) {
      const text = (msg?.content ?? "").trim();
      emit(text ? { type: "answer", text } : { type: "error", message: "No answer came back. Please try rephrasing." });
      return used;
    }
    messages.push({ role: "assistant", content: msg?.content ?? null, tool_calls: calls });
    for (const c of calls) { used.push(c.function.name); emit({ type: "tool", label: LABEL[c.function.name] ?? c.function.name }); }
    const results = await read(async (t) => {
      const out: ChatMessage[] = [];
      for (const c of calls) { // sequential: one transaction connection
        let content: string;
        try {
          const args = c.function.arguments ? JSON.parse(c.function.arguments) : {};
          content = JSON.stringify(await runTool(t, s, c.function.name, args)).slice(0, 60_000);
        } catch (e) {
          if (!(e instanceof z.ZodError) && !(e instanceof SyntaxError)) console.error(`ask tool ${c.function.name}:`, e);
          content = e instanceof z.ZodError ? `Error: invalid input: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`
            : e instanceof SyntaxError ? "Error: arguments were not valid JSON." : "Error: the query failed.";
        }
        out.push({ role: "tool", tool_call_id: c.id, name: c.function.name, content });
      }
      return out;
    });
    messages.push(...results);
  }
  emit({ type: "error", message: "That took too many steps. Try a narrower question." });
  return used;
}
