import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import type { Ctx } from "@/lib/auth";
import { abcClassify, ageBalance, deadStock, expiryTrend, pct, priceImpact } from "@/lib/analytics";
import { addDays, dayRange } from "@/lib/format";
import type { Permission } from "@/lib/permissions";
import type { Feature } from "@/lib/plans";
import { denseSeries, type Preset, type Range } from "./range";

export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type Col = { key: string; label: string; kind?: "money" | "int" | "pct" | "num" | "text" };
export type ReportArgs = { ctx: Ctx; range: Range; branches: string[]; today: string; days: number };
export type Report = {
  title: string; group: string; description: string; cols: Col[];
  /** Bar chart of this column against the first column. */
  chart?: string;
  /** Extra permission beyond reports.view (cost and margin need reports.margin). */
  perm?: Permission;
  feature?: Feature;
  /** A point-in-time view: the date range does not apply. */
  snapshot?: boolean;
  /** Names customers: views and downloads are audited. */
  customerData?: boolean;
  /** Totals row makes no sense (percentages, balances per line already shown). */
  noTotals?: boolean;
  defaultPreset?: Preset;
  /** Optional ?days= choice (dead stock). */
  days?: { label: string; values: number[]; default: number };
  run: (t: Tx, a: ReportArgs) => Promise<Row[]>;
};

const q = async <T extends Row>(t: Tx, s: SQL) => (await t.execute(s)) as unknown as T[];
const inB = (col: SQL, a: ReportArgs) => sql`${col} in ${a.branches}`;
// ISO strings, not Date: drizzle's postgres-js driver passes timestamp params through unserialized.
const inRange = (col: SQL, r: Range) => sql`${col} >= ${r.start.toISOString()} and ${col} < ${r.end.toISOString()}`;
const localDate = (col: SQL, a: ReportArgs) => sql`(${col} at time zone ${a.ctx.tenant.timezone})::date::text`;
const localMonth = (col: SQL, a: ReportArgs) => sql`to_char(${col} at time zone ${a.ctx.tenant.timezone}, 'YYYY-MM')`;
const iso = (col: SQL) => sql`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const toMap = (rows: Row[], key: string, val: string) => new Map(rows.map((x) => [String(x[key]), Number(x[val])]));
const months = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addDays(`${m}-28`, 7).slice(0, 7)) out.push(m);
  return out;
};

// A sale line's share the customer kept (partial returns reduce revenue, cost and units proportionally).
const KEPT = sql`((sl.base_qty - sl.returned_base_qty)::numeric / nullif(sl.base_qty, 0))`;
const NET = sql`((sl.total_minor - sl.tax_minor) * ${KEPT})`; // revenue excluding tax
const COST = sql`(sl.cost_minor * ${KEPT})`;
const UNITS = sql`(sl.base_qty - sl.returned_base_qty)`;
/** Kept sale lines in the range, joined to products (p) and sales (s). */
const LINES = (a: ReportArgs, joins: SQL = sql``) => sql`from sale_lines sl join sales s on s.id = sl.sale_id join products p on p.id = sl.product_id ${joins}
  where s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)}`;
// Retail price of one base unit: the cheapest sellable pack, per base unit.
const RETAIL_PER_BASE = sql`(select min(u.sell_price_minor::numeric / u.factor) from product_units u where u.product_id = p.id and u.sellable)`;
const PRODUCT = sql`p.name || coalesce(' ' || p.strength, '')`;
const marginRow = (r: Row): Row => ({ ...r, margin: Number(r.revenue) - Number(r.cost), marginPct: pct(Number(r.revenue) - Number(r.cost), Number(r.revenue)) });

const takingsCols: Col[] = [{ key: "sales", label: "Sales", kind: "int" }, { key: "takings", label: "Takings", kind: "money" }];
const marginCols: Col[] = [{ key: "units", label: "Units", kind: "int" }, { key: "revenue", label: "Revenue ex tax", kind: "money" }, { key: "cost", label: "Cost", kind: "money" }, { key: "margin", label: "Margin", kind: "money" }, { key: "marginPct", label: "Margin", kind: "pct" }];

export const REPORTS = {
  // ---------------- Sales ----------------
  "sales-day": {
    title: "Sales by day", group: "Sales", description: "Takings, number of sales and average basket each day.",
    cols: [{ key: "day", label: "Day" }, ...takingsCols, { key: "basket", label: "Avg basket", kind: "money" }, { key: "discounts", label: "Discounts", kind: "money" }, { key: "tax", label: "Tax", kind: "money" }],
    chart: "takings",
    async run(t, a) {
      const rows = await q(t, sql`select ${localDate(sql`s.sold_at`, a)} as day, count(*)::int as sales, sum(s.total_minor)::int as takings,
          sum(s.discount_minor)::int as discounts, sum(s.tax_minor)::int as tax
        from sales s where s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)} group by 1`);
      const by = new Map(rows.map((r) => [String(r.day), r]));
      return denseSeries(a.range.from, a.range.to, toMap(rows, "day", "takings")).map(({ day }) => {
        const r = by.get(day);
        const n = Number(r?.sales ?? 0), takings = Number(r?.takings ?? 0);
        return { day, sales: n, takings, basket: n ? Math.round(takings / n) : 0, discounts: Number(r?.discounts ?? 0), tax: Number(r?.tax ?? 0) };
      });
    },
  },
  "sales-hour": {
    title: "Sales by hour", group: "Sales", description: "When the counter is busiest, to plan staff and breaks.",
    cols: [{ key: "hour", label: "Hour" }, ...takingsCols], chart: "takings",
    async run(t, a) {
      const rows = await q(t, sql`select extract(hour from s.sold_at at time zone ${a.ctx.tenant.timezone})::int as h, count(*)::int as sales, sum(s.total_minor)::int as takings
        from sales s where s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)} group by 1`);
      return Array.from({ length: 24 }, (_, h) => {
        const r = rows.find((x) => Number(x.h) === h);
        return { hour: `${String(h).padStart(2, "0")}:00`, sales: Number(r?.sales ?? 0), takings: Number(r?.takings ?? 0) };
      }).filter((r, h) => r.sales || (h >= 7 && h <= 21));
    },
  },
  "sales-product": {
    title: "Sales by product", group: "Sales", description: "Units and revenue (excluding tax, after returns) per product.",
    cols: [{ key: "product", label: "Product" }, { key: "units", label: "Units", kind: "int" }, { key: "revenue", label: "Revenue ex tax", kind: "money" }],
    run: (t, a) => q(t, sql`select ${PRODUCT} as product, sum(${UNITS})::int as units, round(sum(${NET}))::int as revenue ${LINES(a)}
      group by p.id, p.name, p.strength order by 3 desc`),
  },
  "sales-category": {
    title: "Sales by category", group: "Sales", description: "Revenue (excluding tax, after returns) per product category.",
    cols: [{ key: "category", label: "Category" }, { key: "units", label: "Units", kind: "int" }, { key: "revenue", label: "Revenue ex tax", kind: "money" }],
    chart: "revenue",
    run: (t, a) => q(t, sql`select coalesce(c.name, 'Uncategorised') as category, sum(${UNITS})::int as units, round(sum(${NET}))::int as revenue
      ${LINES(a, sql`left join categories c on c.id = p.category_id`)} group by 1 order by 3 desc`),
  },
  "sales-cashier": {
    title: "Sales by cashier", group: "Sales", description: "Who rang up what, with average basket.",
    cols: [{ key: "cashier", label: "Cashier" }, ...takingsCols, { key: "basket", label: "Avg basket", kind: "money" }],
    async run(t, a) {
      const rows = await q(t, sql`select coalesce(u.name, 'Unknown') as cashier, count(*)::int as sales, sum(s.total_minor)::int as takings
        from sales s left join users u on u.id = s.cashier_id
        where s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)} group by 1 order by 3 desc`);
      return rows.map((r) => ({ ...r, basket: Number(r.sales) ? Math.round(Number(r.takings) / Number(r.sales)) : 0 }));
    },
  },
  "sales-payment": {
    title: "Payments by method", group: "Sales", description: "Cash, mobile money, card, bank, insurance share and points, net of refunds.",
    cols: [{ key: "method", label: "Method" }, { key: "payments", label: "Payments", kind: "int" }, { key: "received", label: "Received", kind: "money" }, { key: "refunded", label: "Refunded", kind: "money" }, { key: "net", label: "Net", kind: "money" }],
    chart: "net",
    run: (t, a) => q(t, sql`select replace(p.method::text, '_', ' ') as method, count(*) filter (where p.amount_minor > 0)::int as payments,
        coalesce(sum(p.amount_minor) filter (where p.amount_minor > 0), 0)::int as received, coalesce(-sum(p.amount_minor) filter (where p.amount_minor < 0), 0)::int as refunded,
        sum(p.amount_minor)::int as net
      from payments p where p.status = 'succeeded' and ${inRange(sql`p.received_at`, a.range)} and ${inB(sql`p.branch_id`, a)} group by 1 order by 5 desc`),
  },
  branches: {
    title: "Branch comparison", group: "Sales", description: "Every branch side by side: takings, margin, basket, stock and expiry exposure.", feature: "consolidated", perm: "reports.margin", noTotals: true,
    cols: [{ key: "branch", label: "Branch" }, ...takingsCols, { key: "basket", label: "Avg basket", kind: "money" }, { key: "margin", label: "Margin", kind: "money" }, { key: "marginPct", label: "Margin", kind: "pct" },
      { key: "stock", label: "Stock at cost", kind: "money" }, { key: "nearExpiry", label: "Expiring ≤90d", kind: "money" }, { key: "alerts", label: "Open alerts", kind: "int" }],
    chart: "takings",
    async run(t, a) {
      const near = addDays(a.today, 90);
      const rows = await q(t, sql`select b.name as branch,
          (select count(*) from sales s where s.branch_id = b.id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)})::int as sales,
          (select coalesce(sum(s.total_minor), 0) from sales s where s.branch_id = b.id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)})::int as takings,
          (select coalesce(round(sum(${NET})), 0) from sale_lines sl join sales s on s.id = sl.sale_id where s.branch_id = b.id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)})::int as revenue,
          (select coalesce(round(sum(${COST})), 0) from sale_lines sl join sales s on s.id = sl.sale_id where s.branch_id = b.id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)})::int as cost,
          (select coalesce(round(sum(qty_on_hand * unit_cost_minor)), 0) from stock_batches where branch_id = b.id and qty_on_hand > 0)::bigint as stock,
          (select coalesce(round(sum(qty_on_hand * unit_cost_minor)), 0) from stock_batches where branch_id = b.id and qty_on_hand > 0 and expiry >= ${a.today} and expiry <= ${near})::bigint as "nearExpiry",
          (select count(*) from alerts al where al.branch_id = b.id and al.status = 'open')::int as alerts
        from branches b where ${inB(sql`b.id`, a)} order by b.name`);
      return rows.map((r) => ({ ...marginRow(r), basket: Number(r.sales) ? Math.round(Number(r.takings) / Number(r.sales)) : 0, stock: Number(r.stock), nearExpiry: Number(r.nearExpiry) }));
    },
  },

  // ---------------- Margin ----------------
  "margin-product": {
    title: "Margin by product", group: "Margin", description: "Revenue, FEFO batch cost and gross margin per product. Lowest margins first shows what to reprice.", perm: "reports.margin", noTotals: false,
    cols: [{ key: "product", label: "Product" }, ...marginCols],
    async run(t, a) {
      const rows = await q(t, sql`select ${PRODUCT} as product, sum(${UNITS})::int as units, round(sum(${NET}))::int as revenue, round(sum(${COST}))::int as cost
        ${LINES(a)} group by p.id, p.name, p.strength`);
      return rows.map(marginRow).sort((x, y) => Number(y.margin) - Number(x.margin));
    },
  },
  "margin-category": {
    title: "Margin by category", group: "Margin", description: "Gross margin per category.", perm: "reports.margin", chart: "margin",
    cols: [{ key: "category", label: "Category" }, ...marginCols],
    async run(t, a) {
      const rows = await q(t, sql`select coalesce(c.name, 'Uncategorised') as category, sum(${UNITS})::int as units, round(sum(${NET}))::int as revenue, round(sum(${COST}))::int as cost
        ${LINES(a, sql`left join categories c on c.id = p.category_id`)} group by 1`);
      return rows.map(marginRow).sort((x, y) => Number(y.margin) - Number(x.margin));
    },
  },
  abc: {
    title: "ABC analysis", group: "Margin", description: "A items make 80% of revenue, B the next 15%, C the last 5%. Never run out of A items; question the C list.", noTotals: true,
    cols: [{ key: "product", label: "Product" }, { key: "abc", label: "Class" }, { key: "revenue", label: "Revenue ex tax", kind: "money" }, { key: "share", label: "Share", kind: "pct" }, { key: "cumShare", label: "Cumulative", kind: "pct" }, { key: "units", label: "Units", kind: "int" }],
    defaultPreset: "last90",
    async run(t, a) {
      const rows = await q<{ product: string; revenue: number; units: number }>(t, sql`select ${PRODUCT} as product, coalesce(round(sum(${NET}) filter (where s.id is not null)), 0)::int as revenue,
          coalesce(sum(${UNITS}) filter (where s.id is not null), 0)::int as units
        from products p left join sale_lines sl on sl.product_id = p.id
          left join sales s on s.id = sl.sale_id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)}
        where p.active group by p.id, p.name, p.strength`);
      return abcClassify(rows.map((r) => ({ ...r, revenue: Number(r.revenue) })));
    },
  },
  "price-impact": {
    title: "Price-change impact", group: "Margin", description: "For each price change in the period: units a day and margin a day in the 30 days before vs after.", perm: "reports.margin", noTotals: true,
    cols: [{ key: "product", label: "Product" }, { key: "changedOn", label: "Changed" }, { key: "unit", label: "Pack" }, { key: "oldPrice", label: "Old price", kind: "money" }, { key: "newPrice", label: "New price", kind: "money" },
      { key: "unitsBefore", label: "Units/day before", kind: "num" }, { key: "unitsAfter", label: "Units/day after", kind: "num" }, { key: "unitsChange", label: "Units change", kind: "pct" },
      { key: "marginBefore", label: "Margin/day before", kind: "money" }, { key: "marginAfter", label: "Margin/day after", kind: "money" }],
    defaultPreset: "last90",
    async run(t, a) {
      const changes = await q<{ productId: string; product: string; unit: string; oldPrice: number; newPrice: number; at: string; day: string }>(t, sql`
        select pc.product_id as "productId", ${PRODUCT} as product, u.name as unit, pc.old_price_minor as "oldPrice", pc.new_price_minor as "newPrice", ${iso(sql`pc.created_at`)} as at, ${localDate(sql`pc.created_at`, a)} as day
        from price_changes pc join products p on p.id = pc.product_id join product_units u on u.id = pc.unit_id
        where ${inRange(sql`pc.created_at`, a.range)} order by pc.created_at desc limit 200`);
      const out: Row[] = [];
      const now = Date.now();
      for (const c of changes) {
        const at = new Date(c.at);
        const from = new Date(at.getTime() - 30 * 86400_000), to = new Date(Math.min(at.getTime() + 30 * 86400_000, now));
        const [w] = await q<{ ub: number; rb: number; cb: number; ua: number; ra: number; ca: number }>(t, sql`select
            coalesce(sum(${UNITS}) filter (where s.sold_at < ${at.toISOString()}), 0)::int as ub, coalesce(sum(${NET}) filter (where s.sold_at < ${at.toISOString()}), 0)::float as rb,
            coalesce(sum(${COST}) filter (where s.sold_at < ${at.toISOString()}), 0)::float as cb,
            coalesce(sum(${UNITS}) filter (where s.sold_at >= ${at.toISOString()}), 0)::int as ua, coalesce(sum(${NET}) filter (where s.sold_at >= ${at.toISOString()}), 0)::float as ra,
            coalesce(sum(${COST}) filter (where s.sold_at >= ${at.toISOString()}), 0)::float as ca
          from sale_lines sl join sales s on s.id = sl.sale_id
          where sl.product_id = ${c.productId} and s.status <> 'voided' and s.sold_at >= ${from.toISOString()} and s.sold_at < ${to.toISOString()} and ${inB(sql`s.branch_id`, a)}`);
        const daysAfter = Math.max((to.getTime() - at.getTime()) / 86400_000, 1);
        const r = priceImpact({ units: w.ub, revenue: w.rb, cost: w.cb, days: 30 }, { units: w.ua, revenue: w.ra, cost: w.ca, days: daysAfter });
        out.push({ product: c.product, changedOn: c.day, unit: c.unit, oldPrice: c.oldPrice, newPrice: c.newPrice, unitsBefore: r.unitsPerDayBefore, unitsAfter: r.unitsPerDayAfter,
          unitsChange: r.unitsChangePct, marginBefore: r.marginPerDayBefore, marginAfter: r.marginPerDayAfter });
      }
      return out;
    },
  },

  // ---------------- Stock ----------------
  valuation: {
    title: "Stock valuation", group: "Stock", description: "What is on the shelf now, at cost and at retail price.", snapshot: true,
    cols: [{ key: "product", label: "Product" }, { key: "onHand", label: "On hand", kind: "int" }, { key: "unit", label: "Unit" }, { key: "cost", label: "At cost", kind: "money" }, { key: "retail", label: "At retail", kind: "money" }],
    run: (t, a) => q(t, sql`select ${PRODUCT} as product, sum(b.qty_on_hand)::int as "onHand", p.base_unit as unit, round(sum(b.qty_on_hand * b.unit_cost_minor))::bigint::float8 as cost,
        round(sum(b.qty_on_hand) * coalesce(${RETAIL_PER_BASE}, 0))::bigint::float8 as retail
      from stock_batches b join products p on p.id = b.product_id where b.qty_on_hand > 0 and ${inB(sql`b.branch_id`, a)}
      group by p.id, p.name, p.strength, p.base_unit order by 4 desc`),
  },
  "near-expiry": {
    title: "Near-expiry exposure", group: "Stock", description: "Batches expiring in the next 90 days (and expired ones still on the shelf), with value at cost.", snapshot: true,
    cols: [{ key: "product", label: "Product" }, { key: "batch", label: "Batch" }, { key: "expiry", label: "Expiry" }, { key: "daysLeft", label: "Days left", kind: "int" }, { key: "qty", label: "Qty", kind: "int" }, { key: "value", label: "Value at cost", kind: "money" }, { key: "supplier", label: "Supplier" }],
    run: (t, a) => q(t, sql`select ${PRODUCT} as product, nullif(b.batch_no, '') as batch, b.expiry::text as expiry, (b.expiry - ${a.today}::date)::int as "daysLeft",
        b.qty_on_hand as qty, round(b.qty_on_hand * b.unit_cost_minor)::bigint::float8 as value, sup.name as supplier
      from stock_batches b join products p on p.id = b.product_id left join suppliers sup on sup.id = b.supplier_id
      where b.qty_on_hand > 0 and b.expiry is not null and b.expiry <= ${addDays(a.today, 90)} and ${inB(sql`b.branch_id`, a)} order by b.expiry`),
  },
  "dead-stock": {
    title: "Dead stock", group: "Stock", description: "Items with stock that haven't sold in a while: cash tied up on the shelf.", snapshot: true,
    days: { label: "No sales in", values: [30, 60, 90, 180], default: 90 },
    cols: [{ key: "product", label: "Product" }, { key: "onHand", label: "On hand", kind: "int" }, { key: "value", label: "Value at cost", kind: "money" }, { key: "lastSold", label: "Last sold" }],
    async run(t, a) {
      const rows = await q<{ product: string; onHand: number; value: number; lastSoldAt: string | null; firstReceivedAt: string | null }>(t, sql`
        select ${PRODUCT} as product, sum(b.qty_on_hand)::int as "onHand", round(sum(b.qty_on_hand * b.unit_cost_minor))::float8 as value,
          ${iso(sql`(select max(s.sold_at) from sale_lines sl join sales s on s.id = sl.sale_id where sl.product_id = p.id and s.status <> 'voided' and ${inB(sql`s.branch_id`, a)})`)} as "lastSoldAt",
          ${iso(sql`min(b.received_at)`)} as "firstReceivedAt"
        from stock_batches b join products p on p.id = b.product_id where b.qty_on_hand > 0 and ${inB(sql`b.branch_id`, a)} group by p.id, p.name, p.strength`);
      const cutoff = dayRange(addDays(a.today, -a.days), a.ctx.tenant.timezone).start;
      return deadStock(rows, cutoff).map(({ product, onHand, value, lastSoldAt }) => ({ product, onHand, value, lastSold: lastSoldAt ? lastSoldAt.slice(0, 10) : "Never" }));
    },
  },
  "batch-capture": {
    title: "Batch and expiry capture", group: "Stock", description: "Share of stock recorded with a batch number and expiry date. Target: 90% within 60 days of going live.", snapshot: true, noTotals: true,
    cols: [{ key: "branch", label: "Branch" }, { key: "batches", label: "Stock lines", kind: "int" }, { key: "captured", label: "With batch + expiry", kind: "int" }, { key: "linesPct", label: "Lines", kind: "pct" }, { key: "unitsPct", label: "Units", kind: "pct" }, { key: "valuePct", label: "Value", kind: "pct" }],
    async run(t, a) {
      // Non-drug items don't expire, so they count as captured when they have no expiry by design.
      const rows = await q(t, sql`select br.name as branch, count(*)::int as batches,
          count(*) filter (where p.schedule = 'non_drug' or (b.batch_no <> '' and b.expiry is not null))::int as captured,
          sum(b.qty_on_hand)::float8 as units, coalesce(sum(b.qty_on_hand) filter (where p.schedule = 'non_drug' or (b.batch_no <> '' and b.expiry is not null)), 0)::float8 as "unitsOk",
          sum(b.qty_on_hand * b.unit_cost_minor)::float8 as value, coalesce(sum(b.qty_on_hand * b.unit_cost_minor) filter (where p.schedule = 'non_drug' or (b.batch_no <> '' and b.expiry is not null)), 0)::float8 as "valueOk"
        from stock_batches b join products p on p.id = b.product_id join branches br on br.id = b.branch_id
        where b.qty_on_hand > 0 and ${inB(sql`b.branch_id`, a)} group by br.name order by br.name`);
      return rows.map((r) => ({ branch: r.branch, batches: r.batches, captured: r.captured, linesPct: pct(Number(r.captured), Number(r.batches)), unitsPct: pct(Number(r.unitsOk), Number(r.units)), valuePct: pct(Number(r.valueOk), Number(r.value)) }));
    },
  },
  stockouts: {
    title: "Stock-outs per month", group: "Stock", description: "How often items ran out (out-of-stock alerts raised by the nightly check, plus offline sales the books couldn't cover).", defaultPreset: "last12m",
    cols: [{ key: "month", label: "Month" }, { key: "stockouts", label: "Stock-outs", kind: "int" }, { key: "products", label: "Products affected", kind: "int" }, { key: "shortfalls", label: "Offline shortfalls", kind: "int" }],
    chart: "stockouts",
    async run(t, a) {
      const rows = await q(t, sql`select ${localMonth(sql`created_at`, a)} as month, count(*) filter (where kind = 'out_of_stock')::int as stockouts,
          count(distinct product_id) filter (where kind = 'out_of_stock')::int as products, count(*) filter (where kind = 'stock_discrepancy')::int as shortfalls
        from alerts where kind in ('out_of_stock', 'stock_discrepancy') and ${inRange(sql`created_at`, a.range)} and ${inB(sql`branch_id`, a)} group by 1`);
      return months(a.range.from, a.range.to).map((m) => {
        const r = rows.find((x) => x.month === m);
        return { month: m, stockouts: Number(r?.stockouts ?? 0), products: Number(r?.products ?? 0), shortfalls: Number(r?.shortfalls ?? 0) };
      });
    },
  },

  // ---------------- Expiry ----------------
  "expiry-losses": {
    title: "Expiry losses", group: "Expiry", description: "Expired stock written off each month at cost, as a share of cost of sales, against your first months on PharmaStock (the baseline).",
    defaultPreset: "last12m", chart: "writeOff",
    cols: [{ key: "month", label: "Month" }, { key: "writeOff", label: "Expired write-offs", kind: "money" }, { key: "damage", label: "Damaged", kind: "money" }, { key: "cogs", label: "Cost of sales", kind: "money" },
      { key: "pctOfCogs", label: "Expiry / cost of sales", kind: "pct" }, { key: "vsBaseline", label: "vs baseline", kind: "pct" }],
    async run(t, a) {
      const rows = await q(t, sql`select ${localMonth(sql`created_at`, a)} as month,
          coalesce(round(-sum(qty * unit_cost_minor) filter (where type = 'expire')), 0)::float8 as "writeOff",
          coalesce(round(-sum(qty * unit_cost_minor) filter (where type = 'damage')), 0)::float8 as damage,
          coalesce(round(-sum(qty * unit_cost_minor) filter (where type in ('sale', 'sale_return'))), 0)::float8 as cogs
        from stock_movements where type in ('expire', 'damage', 'sale', 'sale_return') and ${inRange(sql`created_at`, a.range)} and ${inB(sql`branch_id`, a)} group by 1`);
      const list = months(a.range.from, a.range.to).map((m) => {
        const r = rows.find((x) => x.month === m);
        return { month: m, writeOff: Number(r?.writeOff ?? 0), damage: Number(r?.damage ?? 0), cogs: Number(r?.cogs ?? 0) };
      });
      return expiryTrend(list).rows;
    },
  },

  // ---------------- Purchasing ----------------
  "purchases-supplier": {
    title: "Purchases by supplier", group: "Purchasing", description: "Deliveries received, payments made and what is still owed to each supplier.",
    cols: [{ key: "supplier", label: "Supplier" }, { key: "deliveries", label: "Deliveries", kind: "int" }, { key: "received", label: "Received", kind: "money" }, { key: "paid", label: "Paid in period", kind: "money" }, { key: "owed", label: "Owed now", kind: "money" }],
    chart: "received",
    run: (t, a) => q(t, sql`select sup.name as supplier,
        (select count(*) from goods_receipts g where g.supplier_id = sup.id and ${inRange(sql`g.received_at`, a.range)} and ${inB(sql`g.branch_id`, a)})::int as deliveries,
        (select coalesce(sum(g.total_minor), 0) from goods_receipts g where g.supplier_id = sup.id and ${inRange(sql`g.received_at`, a.range)} and ${inB(sql`g.branch_id`, a)})::int as received,
        (select coalesce(sum(sp.amount_minor), 0) from supplier_payments sp where sp.supplier_id = sup.id and sp.paid_at between ${a.range.from} and ${a.range.to})::int as paid,
        (select coalesce(sum(g.total_minor - g.paid_minor), 0) from goods_receipts g where g.supplier_id = sup.id and ${inB(sql`g.branch_id`, a)})::int as owed
      from suppliers sup order by 3 desc`).then((rows) => rows.filter((r) => Number(r.deliveries) || Number(r.paid) || Number(r.owed))),
  },

  // ---------------- Finance ----------------
  tax: {
    title: "Tax on sales", group: "Finance", description: "Output tax collected by rate, from sale lines after returns. Use it for your VAT / sales tax return.",
    cols: [{ key: "rate", label: "Rate" }, { key: "lines", label: "Lines", kind: "int" }, { key: "net", label: "Sales ex tax", kind: "money" }, { key: "tax", label: "Tax", kind: "money" }, { key: "gross", label: "Sales incl. tax", kind: "money" }],
    run: (t, a) => q(t, sql`select rtrim(rtrim((sl.tax_bp / 100.0)::numeric(10, 2)::text, '0'), '.') || '%' as rate, count(*)::int as lines, round(sum(${NET}))::int as net, round(sum(sl.tax_minor * ${KEPT}))::int as tax,
        round(sum(sl.total_minor * ${KEPT}))::int as gross ${LINES(a)} group by sl.tax_bp order by sl.tax_bp`),
  },
  "credit-aging": {
    title: "Customer credit aging", group: "Finance", description: "Who owes the pharmacy and for how long. Oldest debts are the hardest to collect.", snapshot: true, customerData: true,
    cols: [{ key: "customer", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "balance", label: "Owes", kind: "money" }, { key: "b0", label: "0–30 days", kind: "money" }, { key: "b1", label: "31–60 days", kind: "money" }, { key: "b2", label: "61–90 days", kind: "money" }, { key: "b3", label: "90+ days", kind: "money" }],
    async run(t, a) {
      const custs = await q<{ id: string; customer: string; phone: string | null; balance: number }>(t, sql`select id, name as customer, phone, balance_minor as balance
        from customers where balance_minor > 0 and deleted_at is null order by balance_minor desc limit 1000`);
      if (!custs.length) return [];
      const charges = await q<{ customerId: string; amount: number; day: string }>(t, sql`select customer_id as "customerId", amount_minor as amount, ${localDate(sql`created_at`, a)} as day
        from customer_ledger where amount_minor > 0 and customer_id in ${custs.map((c) => c.id)}`);
      return custs.map((c) => {
        const [b0, b1, b2, b3] = ageBalance(c.balance, charges.filter((x) => x.customerId === c.id), a.today);
        return { customer: c.customer, phone: c.phone, balance: c.balance, b0, b1, b2, b3 };
      });
    },
  },
  "loyalty-liability": {
    title: "Loyalty points liability", group: "Finance", description: "Points customers hold and what they are worth at redemption.", snapshot: true, customerData: true, feature: "loyalty",
    cols: [{ key: "customer", label: "Customer" }, { key: "points", label: "Points", kind: "int" }, { key: "value", label: "Worth", kind: "money" }],
    run: (t, a) => q(t, sql`select name as customer, loyalty_points as points, (loyalty_points * ${a.ctx.tenant.loyaltyPointValueMinor})::int as value
      from customers where loyalty_points > 0 and deleted_at is null order by loyalty_points desc limit 2000`),
  },

  // ---------------- Staff ----------------
  staff: {
    title: "Discounts, voids and returns by staff", group: "Staff", description: "Staff accountability: who gave discounts, voided sales and processed refunds.",
    cols: [{ key: "user", label: "Staff" }, { key: "sales", label: "Sales", kind: "int" }, { key: "discounts", label: "Discounts given", kind: "money" }, { key: "voids", label: "Voids", kind: "int" }, { key: "voidValue", label: "Voided value", kind: "money" }, { key: "returns", label: "Returns", kind: "int" }, { key: "refunds", label: "Refunded", kind: "money" }],
    run: (t, a) => q(t, sql`select u.name as user,
        (select count(*) from sales s where s.cashier_id = u.id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)})::int as sales,
        (select coalesce(sum(s.discount_minor), 0) from sales s where s.cashier_id = u.id and s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)})::int as discounts,
        (select count(*) from sales s where s.voided_by = u.id and s.status = 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)})::int as voids,
        (select coalesce(sum(s.total_minor), 0) from sales s where s.voided_by = u.id and s.status = 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)})::int as "voidValue",
        (select count(*) from sale_returns r where r.created_by = u.id and ${inRange(sql`r.created_at`, a.range)} and ${inB(sql`r.branch_id`, a)})::int as returns,
        (select coalesce(sum(r.refund_minor), 0) from sale_returns r where r.created_by = u.id and ${inRange(sql`r.created_at`, a.range)} and ${inB(sql`r.branch_id`, a)})::int as refunds
      from users u order by u.name`).then((rows) => rows.filter((r) => Number(r.sales) || Number(r.voids) || Number(r.returns))),
  },

  // ---------------- Compliance ----------------
  controlled: {
    title: "Controlled-drug movements", group: "Compliance", description: "Received, supplied, destroyed and other movements per controlled product, with the closing register balance.", feature: "controlled",
    cols: [{ key: "product", label: "Product" }, { key: "branch", label: "Branch" }, { key: "received", label: "Received", kind: "int" }, { key: "supplied", label: "Supplied", kind: "int" }, { key: "returned", label: "Returned in", kind: "int" }, { key: "destroyed", label: "Destroyed", kind: "int" }, { key: "other", label: "Other (net)", kind: "int" }, { key: "closing", label: "Closing balance", kind: "int" }],
    noTotals: true,
    run: (t, a) => q(t, sql`select ${PRODUCT} as product, br.name as branch,
        coalesce(sum(r.qty_in) filter (where r.kind in ('received', 'transfer_in')), 0)::int as received,
        coalesce(sum(r.qty_out) filter (where r.kind = 'supplied'), 0)::int as supplied,
        coalesce(sum(r.qty_in) filter (where r.kind = 'returned_by_patient'), 0)::int as returned,
        coalesce(sum(r.qty_out) filter (where r.kind = 'destroyed'), 0)::int as destroyed,
        coalesce(sum(r.qty_in - r.qty_out) filter (where r.kind in ('adjusted', 'returned_to_supplier', 'transfer_out')), 0)::int as other,
        (select r2.balance from controlled_register r2 where r2.product_id = p.id and r2.branch_id = br.id and r2.created_at < ${a.range.end.toISOString()} order by r2.entry_no desc limit 1)::int as closing
      from controlled_register r join products p on p.id = r.product_id join branches br on br.id = r.branch_id
      where ${inRange(sql`r.created_at`, a.range)} and ${inB(sql`r.branch_id`, a)} group by p.id, p.name, p.strength, br.id, br.name order by 1, 2`),
  },
} satisfies Record<string, Report>;

export type ReportName = keyof typeof REPORTS;
export const getReport = (name: string): Report | undefined => (REPORTS as Record<string, Report>)[name];
