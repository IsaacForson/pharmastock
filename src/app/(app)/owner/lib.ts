// Pure helpers for the owner console (no DB, unit-tested).
import { addDays, dayRange, localDay } from "@/lib/format";
import { daysBetween } from "../reports/range";

export const PERIODS = { month: "This month", last_month: "Last month", "90d": "Last 90 days", ytd: "Year to date" } as const;
export type PeriodKey = keyof typeof PERIODS;

export type Period = {
  key: PeriodKey; label: string; vs: string; days: number;
  from: string; to: string; start: Date; end: Date;
  prevFrom: string; prevTo: string; prevStart: Date; prevEnd: Date;
};

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const lastOfMonth = (day: string) => addDays(nextMonth(monthStart(day)), -1);
function nextMonth(first: string) {
  const [y, m] = first.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
const prevMonth = (first: string) => monthStart(addDays(first, -1));
/** Same day-of-month in another month, clamped to its last day (Mar 31 -> Feb 28). */
const sameDayIn = (first: string, day: string) => {
  const last = lastOfMonth(first);
  const d = `${first.slice(0, 8)}${day.slice(8)}`;
  return d > last || Number.isNaN(Date.parse(d)) ? last : d;
};

/**
 * Resolves ?period= into local days and UTC [start, end) instants, plus the previous comparable period:
 * month-to-date vs the same days last month, a full month vs the month before, 90 days vs the 90 before, YTD vs the same span last year.
 */
export function resolvePeriod(raw: unknown, tz: string, now = new Date()): Period {
  const key: PeriodKey = typeof raw === "string" && raw in PERIODS ? (raw as PeriodKey) : "month";
  const today = localDay(tz, now);
  let from: string, to: string, prevFrom: string, prevTo: string, vs: string;
  switch (key) {
    case "month": {
      from = monthStart(today); to = today;
      prevFrom = prevMonth(from); prevTo = sameDayIn(prevFrom, today); vs = "vs same days last month";
      break;
    }
    case "last_month": {
      from = prevMonth(monthStart(today)); to = lastOfMonth(from);
      prevFrom = prevMonth(from); prevTo = lastOfMonth(prevFrom); vs = "vs month before";
      break;
    }
    case "90d": {
      from = addDays(today, -89); to = today;
      prevFrom = addDays(today, -179); prevTo = addDays(today, -90); vs = "vs previous 90 days";
      break;
    }
    case "ytd": {
      from = `${today.slice(0, 4)}-01-01`; to = today;
      const y = String(Number(today.slice(0, 4)) - 1);
      prevFrom = `${y}-01-01`; prevTo = sameDayIn(`${y}-${today.slice(5, 7)}-01`, today); vs = "vs same period last year";
      break;
    }
  }
  return {
    key, label: PERIODS[key], vs, days: daysBetween(from, to).length,
    from, to, start: dayRange(from, tz).start, end: dayRange(to, tz).end,
    prevFrom, prevTo, prevStart: dayRange(prevFrom, tz).start, prevEnd: dayRange(prevTo, tz).end,
  };
}

/** The 12 months (YYYY-MM) ending with the month of `to`, and the local first day of the oldest and the month after the newest. */
export function trendMonths(to: string) {
  const months: string[] = [];
  for (let m = monthStart(to); months.length < 12; m = prevMonth(m)) months.unshift(m.slice(0, 7));
  return { months, from: `${months[0]}-01`, until: nextMonth(monthStart(to)) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;

/** "+12% vs …" badge for a KPI; undefined when there is nothing to compare against. */
export function delta(cur: number, prev: number, vs: string, lowerIsBetter = false): { value: string; good: boolean } | undefined {
  if (!prev) return undefined;
  const change = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { value: `${change > 0 ? "+" : ""}${change}% ${vs}`, good: lowerIsBetter ? change <= 0 : change >= 0 };
}

/** Change in percentage points for rates (e.g. collection rate 82% -> 85% = "+3 pts"). */
export function deltaPts(cur: number, prev: number, vs: string, lowerIsBetter = false): { value: string; good: boolean } | undefined {
  if (!prev && !cur) return undefined;
  const d = Math.round((cur - prev) * 10) / 10;
  return { value: `${d > 0 ? "+" : ""}${d} pts ${vs}`, good: lowerIsBetter ? d <= 0 : d >= 0 };
}

/** The selected branch if the user may see it, else null (= all their branches). */
export const pickBranch = (raw: unknown, allowed: string[]) => (typeof raw === "string" && allowed.includes(raw) ? raw : null);

/** Query string with some keys replaced (empty values dropped). */
export function withQuery(base: string, cur: Record<string, string | null | undefined>, patch: Record<string, string | null | undefined> = {}) {
  const q = new URLSearchParams(Object.entries({ ...cur, ...patch }).filter((e): e is [string, string] => !!e[1]));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

// ----// ---------- Activity feed ----------
export const ACTIVITY_TYPES = {
  sales: "Sales", voids: "Voids", returns: "Returns", prices: "Price changes", stock: "Stock adjustments & write-offs",
  controlled: "Controlled drugs", customers: "Customer records", logins: "Sign-ins", exports: "Exports", settings: "Setting changes", support: "Support access",
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;

export type ActivityRow = {
  action: string; entity: string; details: unknown; userName: string | null; customerNo: string | null;
};

const ENTITY_LABEL: Record<string, string> = {
  tenant: "pharmacy settings", branch: "a branch", user: "a staff account", message_template: "a message template",
  integration: "an integration", webhook: "a webhook", api_key: "an API key", customer: "a customer record", sale: "a sale",
  payment: "a payment", product: "a product", supplier_price: "a supplier price", stock_batch: "a batch", purchase_order: "a purchase order",
  supplier: "a supplier", transfer: "a transfer", stock_take: "a stock take", prescription: "a prescription", export_job: "a data export",
  accounting: "accounting data", document: "a document", message_log: "the message log", message_inbox: "the message inbox", owner_console: "the owner console",
  alert: "an alert", claim: "a claim", supplier_return: "a supplier return",
};
const VERB: Record<string, string> = {
  view: "viewed", create: "created", update: "updated", delete: "deleted", revoke: "revoked", export: "exported", download: "downloaded",
  request: "requested", print: "printed", send: "sent", reset_password: "reset the password of", search: "searched", resolve: "resolved",
  set_pin: "set the counter PIN of", clear_pin: "removed the counter PIN of", activate: "reactivated", deactivate: "deactivated",
  import: "imported", receive: "received", quarantine: "quarantined",
};
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

/** Plain-English sentence for an audit entry. `fmt` formats minor-unit money. */
export function describeActivity(r: ActivityRow, fmt: (minor: number) => string): { text: string; type: ActivityType | null } {
  const d = (r.details ?? {}) as Record<string, unknown>;
  const who = r.userName ?? "Someone";
  const cust = r.customerNo ? ` for ${r.customerNo}` : "";
  const amount = (k: string) => (n(d[k]) !== null ? ` ${fmt(n(d[k])!)}` : "");
  const reason = d.reason ? ` — ${String(d.reason)}` : "";
  const thing = ENTITY_LABEL[r.entity] ?? r.entity.replace(/_/g, " ");
  if (d.impersonatedBy) return { text: `PharmaStock support ${VERB[r.action] ?? r.action.replace(/_/g, " ")} ${thing}${cust}`, type: "support" };
  const key = `${r.action}:${r.entity}`;
  switch (key) {
    case "create:sale": return { text: `${who} sold ${d.saleNo ? `${String(d.saleNo)} ` : ""}for${amount("total") || " an amount"}${cust}${d.offline ? " (offline)" : ""}`, type: "sales" };
    case "void:sale": return { text: `${who} voided a sale of${amount("total")}${cust}${reason}`, type: "voids" };
    case "return:sale": return { text: `${who} took a return${d.returnNo ? ` ${String(d.returnNo)}` : ""}, refunding${amount("refund") || " nothing"}${cust}`, type: "returns" };
    case "price_change:product": return { text: `${who} changed a selling price${n(d.from) !== null && n(d.to) !== null ? ` from${amount("from")} to${amount("to")}` : ""}`, type: "prices" };
    case "adjust:stock_batch": return { text: `${who} adjusted stock${n(d.delta) !== null ? ` by ${n(d.delta)! > 0 ? "+" : ""}${n(d.delta)}` : ""}${reason}`, type: d.via === "register" ? "controlled" : "stock" };
    case "write_off:stock_batch": return { text: `${who} wrote off expired or damaged stock${n(d.qty) !== null ? ` (${Math.abs(n(d.qty)!)} units)` : ""}`, type: "stock" };
    case "destroy:stock_batch": return { text: `${who} recorded destruction of a controlled drug${n(d.qty) !== null ? ` (${n(d.qty)} units)` : ""}${d.witness ? `, witnessed by ${String(d.witness)}` : ""}`, type: "controlled" };
    case "view:prescription": return { text: `${who} opened a prescription${cust}`, type: "controlled" };
    case "create:customer": return { text: `${who} added customer ${r.customerNo ?? ""}`.trim(), type: "customers" };
    case "update:customer": return { text: `${who} updated customer ${r.customerNo ?? ""}`.trim(), type: "customers" };
    case "login:user": return { text: `${who} signed in${d.mfa ? " with 2-step verification" : ""}`, type: "logins" };
  }
  if (["export", "download"].includes(r.action) || key === "request:export_job") return { text: `${who} ${VERB[r.action]} ${thing}`, type: "exports" };
  if (SETTING_ENTITIES.includes(r.entity)) return { text: `${who} ${VERB[r.action] ?? r.action.replace(/_/g, " ")} ${thing}`, type: "settings" };
  return { text: `${who} ${VERB[r.action] ?? r.action.replace(/_/g, " ")} ${thing}${cust}`, type: null };
}

/** Entities whose changes count as "setting changes". Shared with the SQL filter. */
export const SETTING_ENTITIES = ["tenant", "branch", "user", "message_template", "integration", "webhook", "api_key"];
