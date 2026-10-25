import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db";
import { buildJournal, type JournalInput } from "@/lib/analytics";
import { toMajor } from "@/lib/format";
import { toCsv, type Range } from "../range";

type A = { range: Range; branches: string[]; all: boolean; tz: string };
type R = Record<string, unknown>;
const q = async <T extends R>(t: Tx, s: SQL) => (await t.execute(s)) as unknown as T[];
const inRange = (col: SQL, r: Range) => sql`${col} >= ${r.start.toISOString()} and ${col} < ${r.end.toISOString()}`;
const inB = (col: SQL, a: A) => sql`${col} in ${a.branches}`;
const n = (v: unknown) => Math.round(Number(v ?? 0));
const local = (col: SQL, a: A) => sql`to_char(${col} at time zone ${a.tz}, 'YYYY-MM-DD HH24:MI')`;

/** Period totals for the double-entry journal (see buildJournal). */
export async function journalInput(t: Tx, a: A): Promise<JournalInput> {
  const sold = sql`s.status <> 'voided' and ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)}`;
  const byRate = await q<{ taxBp: number; net: number; tax: number }>(t, sql`select sl.tax_bp as "taxBp", sum(sl.total_minor - sl.tax_minor)::bigint as net, sum(sl.tax_minor)::bigint as tax
    from sale_lines sl join sales s on s.id = sl.sale_id where ${sold} group by 1 order by 1`);
  const pays = await q<{ method: string; amount: number }>(t, sql`select p.method::text as method, sum(p.amount_minor)::bigint as amount
    from payments p join sales s on s.id = p.sale_id where ${sold} and p.status = 'succeeded' and p.amount_minor > 0 group by 1`);
  const [tot] = await q<{ credit: number; payer: number }>(t, sql`select coalesce(sum(credit_minor), 0)::bigint as credit, coalesce(sum(payer_portion_minor), 0)::bigint as payer from sales s where ${sold}`);
  const returns = await q<{ method: string; amount: number }>(t, sql`select refund_method::text as method, sum(refund_minor)::bigint as amount
    from sale_returns where ${inRange(sql`created_at`, a.range)} and ${inB(sql`branch_id`, a)} group by 1`);
  const [mv] = await q<{ cogs: number; writeOffs: number; adjustments: number }>(t, sql`select
      coalesce(-sum(qty * unit_cost_minor) filter (where type in ('sale', 'sale_return')), 0)::float8 as cogs,
      coalesce(-sum(qty * unit_cost_minor) filter (where type in ('expire', 'damage')), 0)::float8 as "writeOffs",
      coalesce(sum(qty * unit_cost_minor) filter (where type in ('adjust', 'stocktake')), 0)::float8 as adjustments
    from stock_movements where ${inRange(sql`created_at`, a.range)} and ${inB(sql`branch_id`, a)}`);
  const [grn] = await q<{ total: number }>(t, sql`select coalesce(sum(total_minor), 0)::bigint as total from goods_receipts where ${inRange(sql`received_at`, a.range)} and ${inB(sql`branch_id`, a)}`);
  const [sret] = await q<{ total: number }>(t, sql`select coalesce(sum(value_minor), 0)::bigint as total from supplier_returns where ${inRange(sql`created_at`, a.range)} and ${inB(sql`branch_id`, a)}`);
  // Supplier payments carry no branch: attribute them through their goods receipt, or include unlinked ones only for the whole business.
  const spay = await q<{ method: string; amount: number }>(t, sql`select sp.method::text as method, sum(sp.amount_minor)::bigint as amount
    from supplier_payments sp left join goods_receipts g on g.id = sp.receipt_id
    where sp.paid_at between ${a.range.from} and ${a.range.to} and (${inB(sql`g.branch_id`, a)} or (g.id is null and ${a.all})) group by 1`);
  const repay = await q<{ method: string; amount: number }>(t, sql`select method::text as method, sum(amount_minor)::bigint as amount from payments
    where sale_id is null and customer_id is not null and status = 'succeeded' and amount_minor > 0 and ${inRange(sql`received_at`, a.range)} and ${inB(sql`branch_id`, a)} group by 1`);
  const exp = await q<{ category: string; method: string; amount: number }>(t, sql`select category, method::text as method, sum(amount_minor)::bigint as amount from expenses
    where day between ${a.range.from} and ${a.range.to} and ${inB(sql`branch_id`, a)} group by 1, 2 order by 1`);
  const num = <T extends { amount: unknown }>(l: T[]) => l.map((x) => ({ ...x, amount: n(x.amount) }));
  return {
    revenueByRate: byRate.map((r) => ({ taxBp: r.taxBp, net: n(r.net), tax: n(r.tax) })), salePayments: num(pays), creditGiven: n(tot?.credit), payerPortion: n(tot?.payer),
    returns: num(returns), cogs: n(mv?.cogs), receipts: n(grn?.total), supplierReturns: n(sret?.total), supplierPayments: num(spay), repayments: num(repay),
    expenses: num(exp), writeOffs: n(mv?.writeOffs), adjustments: n(mv?.adjustments),
  };
}

const money = (v: unknown) => (v === null || v === undefined ? "" : toMajor(Number(v)));

/** The files the accounting export offers. Each returns CSV text. */
export const DOCS = {
  journal: {
    label: "Journal (double entry)", hint: "One line per account per period: import as a general journal.",
    async csv(t: Tx, a: A) {
      const rows = buildJournal(await journalInput(t, a));
      return toCsv(["Date", "Account", "Debit", "Credit", "Memo"], rows.map((r) => [a.range.to, r.account, r.debit ? toMajor(r.debit) : "", r.credit ? toMajor(r.credit) : "", r.memo]));
    },
  },
  sales: {
    label: "Sales", hint: "One row per sale (invoice): totals, tax, payment status and cost.",
    async csv(t: Tx, a: A) {
      const rows = await q(t, sql`select s.sale_no, ${local(sql`s.sold_at`, a)} as at, b.name as branch, c.name as customer, s.status::text as status, s.subtotal_minor, s.discount_minor,
          s.tax_minor, s.total_minor, s.paid_minor, s.credit_minor, s.payer_portion_minor, s.cost_minor
        from sales s join branches b on b.id = s.branch_id left join customers c on c.id = s.customer_id
        where ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)} order by s.sold_at`);
      return toCsv(["Sale no", "Date", "Branch", "Customer", "Status", "Subtotal", "Discount", "Tax", "Total", "Paid", "On account", "Insurer share", "Cost"],
        rows.map((r) => [r.sale_no, r.at, r.branch, r.customer, r.status, money(r.subtotal_minor), money(r.discount_minor), money(r.tax_minor), money(r.total_minor), money(r.paid_minor), money(r.credit_minor), money(r.payer_portion_minor), money(r.cost_minor)] as (string | number | null)[]));
    },
  },
  "sale-lines": {
    label: "Sale lines", hint: "Every item sold, with tax rate, for line-level e-invoicing or tax audits.",
    async csv(t: Tx, a: A) {
      const rows = await q(t, sql`select s.sale_no, ${local(sql`s.sold_at`, a)} as at, s.status::text as status, sl.description, sl.qty, sl.base_qty, sl.returned_base_qty, sl.unit_price_minor, sl.discount_minor,
          sl.tax_bp, sl.tax_minor, sl.total_minor, sl.cost_minor
        from sale_lines sl join sales s on s.id = sl.sale_id where ${inRange(sql`s.sold_at`, a.range)} and ${inB(sql`s.branch_id`, a)} order by s.sold_at`);
      return toCsv(["Sale no", "Date", "Status", "Item", "Qty (packs)", "Base units", "Returned units", "Unit price", "Discount", "Tax rate (%)", "Tax", "Line total", "Cost"],
        rows.map((r) => [r.sale_no, r.at, r.status, r.description, r.qty, r.base_qty, r.returned_base_qty, money(r.unit_price_minor), money(r.discount_minor), Number(r.tax_bp) / 100, money(r.tax_minor), money(r.total_minor), money(r.cost_minor)] as (string | number | null)[]));
    },
  },
  payments: {
    label: "Payments", hint: "Money received and refunded by method, including customer account repayments.",
    async csv(t: Tx, a: A) {
      const rows = await q(t, sql`select p.receipt_no, ${local(sql`p.received_at`, a)} as at, p.method::text as method, p.status::text as status, p.amount_minor, p.reference, s.sale_no, c.name as customer
        from payments p left join sales s on s.id = p.sale_id left join customers c on c.id = p.customer_id
        where ${inRange(sql`p.received_at`, a.range)} and ${inB(sql`p.branch_id`, a)} order by p.received_at`);
      return toCsv(["Receipt no", "Date", "Method", "Status", "Amount", "Reference", "Sale no", "Customer"],
        rows.map((r) => [r.receipt_no, r.at, r.method, r.status, money(r.amount_minor), r.reference, r.sale_no, r.customer] as (string | number | null)[]));
    },
  },
  purchases: {
    label: "Purchases (goods received)", hint: "Supplier invoices: what arrived, what is paid and when the rest is due.",
    async csv(t: Tx, a: A) {
      const rows = await q(t, sql`select g.grn_no, ${local(sql`g.received_at`, a)} as at, sup.name as supplier, g.supplier_invoice_no, g.total_minor, g.paid_minor, g.due_at::text as due
        from goods_receipts g left join suppliers sup on sup.id = g.supplier_id where ${inRange(sql`g.received_at`, a.range)} and ${inB(sql`g.branch_id`, a)} order by g.received_at`);
      return toCsv(["GRN no", "Received", "Supplier", "Supplier invoice", "Total", "Paid", "Due"], rows.map((r) => [r.grn_no, r.at, r.supplier, r.supplier_invoice_no, money(r.total_minor), money(r.paid_minor), r.due] as (string | number | null)[]));
    },
  },
  "supplier-payments": {
    label: "Supplier payments", hint: "Payments made to suppliers.",
    async csv(t: Tx, a: A) {
      const rows = await q(t, sql`select sp.paid_at::text as day, sup.name as supplier, sp.amount_minor, sp.method::text as method, sp.reference, g.grn_no
        from supplier_payments sp join suppliers sup on sup.id = sp.supplier_id left join goods_receipts g on g.id = sp.receipt_id
        where sp.paid_at between ${a.range.from} and ${a.range.to} and (${inB(sql`g.branch_id`, a)} or (g.id is null and ${a.all})) order by sp.paid_at`);
      return toCsv(["Date", "Supplier", "Amount", "Method", "Reference", "GRN no"], rows.map((r) => [r.day, r.supplier, money(r.amount_minor), r.method, r.reference, r.grn_no] as (string | number | null)[]));
    },
  },
  expenses: {
    label: "Expenses", hint: "Shop expenses by category.",
    async csv(t: Tx, a: A) {
      const rows = await q(t, sql`select e.day::text as day, b.name as branch, e.category, e.description, e.paid_to, e.method::text as method, e.amount_minor
        from expenses e join branches b on b.id = e.branch_id where e.day between ${a.range.from} and ${a.range.to} and ${inB(sql`e.branch_id`, a)} order by e.day`);
      return toCsv(["Date", "Branch", "Category", "Description", "Paid to", "Method", "Amount"], rows.map((r) => [r.day, r.branch, r.category, r.description, r.paid_to, r.method, money(r.amount_minor)] as (string | number | null)[]));
    },
  },
} as const;
export type DocName = keyof typeof DOCS;
