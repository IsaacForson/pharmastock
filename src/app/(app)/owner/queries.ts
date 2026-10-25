import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import type { Ctx } from "@/lib/auth";
import { dayRange } from "@/lib/format";
import { currentSeats } from "../settings/limits";
import { SETTING_ENTITIES, trendMonths, type ActivityType, type Period } from "./lib";

type R = Record<string, unknown>;
const q = async <T extends R = R>(t: Tx, s: SQL) => (await t.execute(s)) as unknown as T[];
const one = async <T extends R = R>(t: Tx, s: SQL) => (await q<T>(t, s))[0];
const iso = (d: Date) => d.toISOString(); // raw sql params aren't serialized by postgres-js
const between = (col: SQL, start: Date, end: Date) => sql`${col} >= ${iso(start)} and ${col} < ${iso(end)}`;

// Revenue is what was charged on sales that weren't voided, less refunds given on returns.
const SOLD = sql`s.status <> 'voided'`;

export type Filter = { branchIds: string[]; period: Period };

export async function overview(t: Tx, ctx: Ctx, { branchIds: b, period: p }: Filter) {
  const tz = ctx.tenant.timezone;
  const inCur = (col: SQL) => between(col, p.start, p.end);
  const inPrev = (col: SQL) => between(col, p.prevStart, p.prevEnd);
  const tr = trendMonths(p.to);
  const trStart = dayRange(tr.from, tz).start, trEnd = dayRange(tr.until, tz).start;
  const month = (col: SQL) => sql`to_char(${col} at time zone ${tz}, 'YYYY-MM')`;

  const sales = await one<{ revenue: number; prevRevenue: number; cost: number; prevCost: number; n: number; prevN: number; discounts: number; prevDiscounts: number; credit: number; offline: number }>(t, sql`select
      coalesce(sum(s.total_minor) filter (where ${inCur(sql`s.sold_at`)}), 0)::bigint as revenue,
      coalesce(sum(s.total_minor) filter (where ${inPrev(sql`s.sold_at`)}), 0)::bigint as "prevRevenue",
      coalesce(sum(s.cost_minor) filter (where ${inCur(sql`s.sold_at`)}), 0)::bigint as cost,
      coalesce(sum(s.cost_minor) filter (where ${inPrev(sql`s.sold_at`)}), 0)::bigint as "prevCost",
      count(*) filter (where ${inCur(sql`s.sold_at`)})::int as n,
      count(*) filter (where ${inPrev(sql`s.sold_at`)})::int as "prevN",
      coalesce(sum(s.discount_minor) filter (where ${inCur(sql`s.sold_at`)}), 0)::bigint as discounts,
      coalesce(sum(s.discount_minor) filter (where ${inPrev(sql`s.sold_at`)}), 0)::bigint as "prevDiscounts",
      coalesce(sum(s.credit_minor) filter (where ${inCur(sql`s.sold_at`)}), 0)::bigint as credit,
      count(*) filter (where s.offline and ${inCur(sql`s.sold_at`)})::int as offline
    from sales s where ${SOLD} and s.branch_id in ${b} and ${between(sql`s.sold_at`, p.prevStart, p.end)}`);
  const refunds = await one<{ cur: number; prev: number; voids: number }>(t, sql`select
      coalesce((select sum(r.refund_minor) from sale_returns r where r.branch_id in ${b} and ${inCur(sql`r.created_at`)}), 0)::bigint as cur,
      coalesce((select sum(r.refund_minor) from sale_returns r where r.branch_id in ${b} and ${inPrev(sql`r.created_at`)}), 0)::bigint as prev,
      (select count(*) from sales s where s.status = 'voided' and s.branch_id in ${b} and ${inCur(sql`s.sold_at`)})::int as voids`);
  const expenses = await one<{ cur: number; prev: number }>(t, sql`select
      coalesce(sum(amount_minor) filter (where day between ${p.from} and ${p.to}), 0)::bigint as cur,
      coalesce(sum(amount_minor) filter (where day between ${p.prevFrom} and ${p.prevTo}), 0)::bigint as prev
    from expenses where branch_id in ${b} and day between ${p.prevFrom} and ${p.to}`);

  // Stock position today: value at cost, value expiring within 90 days, already expired.
  const stock = await one<{ value: number; expiring: number; expired: number; quarantined: number }>(t, sql`select
      coalesce(sum(qty_on_hand * unit_cost_minor), 0)::bigint as value,
      coalesce(sum(qty_on_hand * unit_cost_minor) filter (where expiry >= current_date and expiry < current_date + 90), 0)::bigint as expiring,
      coalesce(sum(qty_on_hand * unit_cost_minor) filter (where expiry < current_date), 0)::bigint as expired,
      coalesce(sum(qty_on_hand * unit_cost_minor) filter (where quarantined), 0)::bigint as quarantined
    from stock_batches where qty_on_hand > 0 and branch_id in ${b}`);
  // Customer accounts aren't tied to a branch, so these are pharmacy-wide.
  const credit = await one<{ owed: number; debtors: number }>(t, sql`select coalesce(sum(balance_minor), 0)::bigint as owed,
      count(*) filter (where balance_minor > 0)::int as debtors from customers where deleted_at is null`);
  const alerts = await one<{ open: number; lowStock: number }>(t, sql`select count(*)::int as open,
      count(*) filter (where kind in ('low_stock', 'out_of_stock'))::int as "lowStock"
    from alerts where status = 'open' and branch_id in ${b}`);

  const trend = await q<{ m: string; kind: string; v: number; v2: number }>(t, sql`
      select ${month(sql`s.sold_at`)} as m, 'sales' as kind, sum(s.total_minor)::bigint as v, sum(s.total_minor - s.cost_minor)::bigint as v2
        from sales s where ${SOLD} and s.branch_id in ${b} and ${between(sql`s.sold_at`, trStart, trEnd)} group by 1
      union all
      select to_char(e.day, 'YYYY-MM'), 'expenses', sum(e.amount_minor)::bigint, 0 from expenses e
        where e.branch_id in ${b} and e.day >= ${tr.from} and e.day < ${tr.until} group by 1`);
  const series = (kind: string, field: "v" | "v2" = "v") => tr.months.map((m) => Number(trend.find((x) => x.m === m && x.kind === kind)?.[field] ?? 0));
  const months = { labels: tr.months, revenue: series("sales"), margin: series("sales", "v2"), expenses: series("expenses") };

  const mix = {
    methods: await q<{ label: string; amount: number; n: number }>(t, sql`select replace(p.method::text, '_', ' ') as label, sum(p.amount_minor)::bigint as amount, count(*)::int as n
      from payments p where p.status = 'succeeded' and p.branch_id in ${b} and ${inCur(sql`p.received_at`)} group by 1 order by 2 desc`),
    products: await q<{ label: string; amount: number; qty: number; margin: number }>(t, sql`select pr.name as label, sum(l.total_minor)::bigint as amount,
        sum(l.base_qty)::int as qty, sum(l.total_minor - l.cost_minor)::bigint as margin
      from sale_lines l join sales s on s.id = l.sale_id join products pr on pr.id = l.product_id
      where ${SOLD} and s.branch_id in ${b} and ${inCur(sql`s.sold_at`)} group by pr.id, pr.name order by 2 desc limit 8`),
    branches: await q<{ label: string; amount: number; n: number }>(t, sql`select br.name as label, sum(s.total_minor)::bigint as amount, count(*)::int as n
      from sales s join branches br on br.id = s.branch_id where ${SOLD} and s.branch_id in ${b} and ${inCur(sql`s.sold_at`)} group by br.id, br.name order by 2 desc`),
  };

  const num = <T extends R>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)])) as { [K in keyof T]: number };
  return {
    sales: num(sales), refunds: num(refunds), expenses: num(expenses), stock: num(stock), credit: num(credit), alerts, months,
    mix: {
      methods: mix.methods.map((r) => ({ ...r, amount: Number(r.amount) })),
      products: mix.products.map((r) => ({ ...r, amount: Number(r.amount), margin: Number(r.margin) })),
      branches: mix.branches.map((r) => ({ ...r, amount: Number(r.amount) })),
    },
  };
}

/** Plan usage: active staff and branches. */
export async function usage(t: Tx, ctx: Ctx) {
  return currentSeats(t, ctx.tenant.id);
}

// ---------- Staff accountability ----------
export type StaffRow = {
  id: string; name: string; role: string; active: boolean; lastLoginAt: string | null; maxDiscountBp: number;
  sales: number; revenue: number; discounts: number; discountedSales: number; voids: number; voidedValue: number;
  returns: number; refunded: number; overrides: number; adjustments: number; supervised: number;
};

/**
 * Per person in the period: what they sold and the money-sensitive things owners watch — discounts given, sales voided,
 * returns refunded, prices changed at the till and stock adjusted. A price override is a sale line charged at a different
 * price from the shelf price in force at the time (from price history).
 */
export async function team(t: Tx, { branchIds: b, period: p }: Filter) {
  const rows = await q<StaffRow>(t, sql`select u.id, u.name, u.role::text as role, u.active, u.last_login_at as "lastLoginAt", u.max_discount_bp as "maxDiscountBp",
      coalesce(sa.n, 0)::int as sales, coalesce(sa.revenue, 0)::bigint as revenue, coalesce(sa.discounts, 0)::bigint as discounts,
      coalesce(sa.discounted, 0)::int as "discountedSales", coalesce(v.n, 0)::int as voids, coalesce(v.value, 0)::bigint as "voidedValue",
      coalesce(rt.n, 0)::int as returns, coalesce(rt.refunded, 0)::bigint as refunded, coalesce(ov.n, 0)::int as overrides,
      coalesce(adj.n, 0)::int as adjustments, coalesce(sup.n, 0)::int as supervised
    from users u
    left join (select s.cashier_id, count(*) as n, sum(s.total_minor) as revenue, sum(s.discount_minor) as discounts,
        count(*) filter (where s.discount_minor > 0) as discounted
      from sales s where s.status <> 'voided' and s.branch_id in ${b} and ${between(sql`s.sold_at`, p.start, p.end)} group by 1) sa on sa.cashier_id = u.id
    left join (select s.voided_by, count(*) as n, sum(s.total_minor) as value from sales s
      where s.status = 'voided' and s.branch_id in ${b} and ${between(sql`s.sold_at`, p.start, p.end)} group by 1) v on v.voided_by = u.id
    left join (select r.created_by, count(*) as n, sum(r.refund_minor) as refunded from sale_returns r
      where r.branch_id in ${b} and ${between(sql`r.created_at`, p.start, p.end)} group by 1) rt on rt.created_by = u.id
    left join (select s.cashier_id, count(*) as n from sale_lines l join sales s on s.id = l.sale_id join product_units pu on pu.id = l.unit_id
      where s.branch_id in ${b} and ${between(sql`s.sold_at`, p.start, p.end)}
        and l.unit_price_minor <> coalesce(
          (select pc.new_price_minor from price_changes pc where pc.unit_id = l.unit_id and pc.created_at <= s.sold_at order by pc.created_at desc limit 1),
          (select pc.old_price_minor from price_changes pc where pc.unit_id = l.unit_id and pc.created_at > s.sold_at order by pc.created_at limit 1),
          pu.sell_price_minor)
      group by 1) ov on ov.cashier_id = u.id
    left join (select m.user_id, count(*) as n from stock_movements m
      where m.type in ('adjust', 'damage', 'expire', 'stocktake') and m.branch_id in ${b} and ${between(sql`m.created_at`, p.start, p.end)} group by 1) adj on adj.user_id = u.id
    left join (select s.pharmacist_id, count(*) as n from sales s
      where s.status <> 'voided' and s.branch_id in ${b} and ${between(sql`s.sold_at`, p.start, p.end)} group by 1) sup on sup.pharmacist_id = u.id
    order by u.active desc, coalesce(sa.revenue, 0) desc, u.name`);
  return rows.map((r) => ({ ...r, revenue: Number(r.revenue), discounts: Number(r.discounts), voidedValue: Number(r.voidedValue), refunded: Number(r.refunded) }));
}

// ---------- Activity ----------
export const ACTIVITY_SQL: Record<ActivityType, SQL> = {
  sales: sql`(a.action = 'create' and a.entity = 'sale')`,
  voids: sql`(a.action = 'void' and a.entity = 'sale')`,
  returns: sql`(a.action = 'return' and a.entity = 'sale')`,
  prices: sql`(a.action in ('price_change', 'price') and a.entity in ('product', 'supplier_price'))`,
  stock: sql`(a.action in ('adjust', 'write_off', 'quarantine') and a.entity = 'stock_batch' and coalesce(a.details->>'via', '') <> 'register')`,
  controlled: sql`((a.action = 'destroy' and a.entity = 'stock_batch') or (a.entity = 'stock_batch' and a.details->>'via' = 'register') or a.entity = 'prescription')`,
  customers: sql`(a.action in ('create', 'update') and a.entity = 'customer')`,
  logins: sql`(a.action = 'login' and a.entity = 'user')`,
  exports: sql`(a.action in ('export', 'download') or (a.action = 'request' and a.entity = 'export_job'))`,
  settings: sql`(a.action in ('create', 'update', 'delete', 'revoke', 'reset_password', 'set_pin', 'clear_pin', 'activate', 'deactivate') and a.entity in ${SETTING_ENTITIES})`,
  support: sql`(a.details ? 'impersonatedBy')`,
};

export type ActivityFeedRow = { id: string; at: string; action: string; entity: string; entityId: string | null; details: unknown; userId: string | null; userName: string | null; customerId: string | null; customerNo: string | null };

export async function activity(t: Tx, f: { type: ActivityType | null; userId: string | null; limit: number; offset: number }) {
  // Without a type filter, routine sales are left out so the feed shows what owners need to check.
  const types = f.type ? ACTIVITY_SQL[f.type] : sql`(${sql.join(Object.entries(ACTIVITY_SQL).filter(([k]) => k !== "sales").map(([, v]) => v), sql` or `)})`;
  return q<ActivityFeedRow>(t, sql`select a.id, a.at, a.action, a.entity, a.entity_id as "entityId", a.details, a.user_id as "userId", u.name as "userName",
      a.customer_id as "customerId", c.customer_no as "customerNo"
    from audit.log a left join users u on u.id = a.user_id left join customers c on c.id = a.customer_id
    where ${types} ${f.userId ? sql`and a.user_id = ${f.userId}` : sql``}
    order by a.at desc limit ${f.limit} offset ${f.offset}`);
}
