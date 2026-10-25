import { asc } from "drizzle-orm";
import { Activity, ChevronLeft, ChevronRight, Filter } from "lucide-react";
import { Button, Field, LinkButton, Panel, Select, Timeline, type Tone } from "@/components/ui";
import { users } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { ACTIVITY_TYPES, describeActivity, withQuery, type ActivityType } from "../lib";
import { activity } from "../queries";
import { ConsoleHeader } from "../ui";

export const metadata = { title: "Activity · Owner console" };
const PER_PAGE = 40;
const TONE: Record<ActivityType, Tone> = {
  sales: "green", voids: "red", returns: "yellow", prices: "purple", stock: "yellow", controlled: "purple",
  customers: "teal", logins: "gray", exports: "blue", settings: "blue", support: "red",
};

export default async function ActivityPage({ searchParams }: PageProps<"/owner/activity">) {
  const ctx = await requireCtx("admin.console");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const type = typeof sp.type === "string" && sp.type in ACTIVITY_TYPES ? (sp.type as ActivityType) : null;
  const userId = typeof sp.user === "string" && /^[0-9a-f-]{36}$/.test(sp.user) ? sp.user : null;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  const { rows, staff } = await tx(ctx, async (t) => {
    await audit(t, ctx, "view", "owner_console", null, { details: { page: "activity", type, user: userId } });
    return {
      staff: await t.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
      rows: await activity(t, { type, userId, limit: PER_PAGE + 1, offset: (page - 1) * PER_PAGE }),
    };
  });
  const filters = { type, user: userId };
  const items = rows.slice(0, PER_PAGE).map((r) => {
    const { text, type: kind } = describeActivity(r, (minor) => money(minor, cur));
    return {
      id: r.id, title: text, tone: kind ? TONE[kind] : ("gray" as Tone),
      meta: `${dateTime(r.at, tz)}${kind ? ` · ${ACTIVITY_TYPES[kind]}` : ""}`,
      href: r.customerId && kind !== "support" ? `/customers/${r.customerId}` : undefined,
    };
  });

  return (
    <>
      <ConsoleHeader ctx={ctx} current="activity" subtitle="Voids, returns, price and stock changes, sign-ins and settings across the pharmacy, newest first" />

      <form className="glass mb-6 grid items-end gap-3 p-4 animate-rise sm:grid-cols-[1fr_1fr_auto]">
        <Field label="Staff">
          <Select name="user" defaultValue={userId ?? ""}><option value="">Everyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        <Field label="Type">
          <Select name="type" defaultValue={type ?? ""}>
            <option value="">Everything except routine sales</option>
            {(Object.keys(ACTIVITY_TYPES) as ActivityType[]).map((k) => <option key={k} value={k}>{ACTIVITY_TYPES[k]}</option>)}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button type="submit"><Filter className="h-4 w-4" aria-hidden /> Filter</Button>
          {(type || userId) && <LinkButton href="/owner/activity" variant="ghost">Clear</LinkButton>}
        </div>
      </form>

      <Panel title="Activity feed" eyebrow={`Page ${page}${type || userId ? " · filtered" : ""}`} icon={<Activity />}
        actions={<LinkButton href="/settings/audit" variant="ghost" size="sm">Full audit log</LinkButton>}>
        {items.length ? <Timeline items={items} /> : <p className="py-10 text-center text-sm text-muted">Nothing matches these filters yet.</p>}
        {(page > 1 || rows.length > PER_PAGE) && (
          <nav className="mt-6 flex items-center justify-between border-t border-line pt-4" aria-label="Pages">
            {page > 1 ? <LinkButton href={withQuery("/owner/activity", filters, { page: page > 2 ? String(page - 1) : null })} variant="secondary" size="sm"><ChevronLeft className="h-4 w-4" aria-hidden /> Newer</LinkButton> : <span />}
            {rows.length > PER_PAGE && <LinkButton href={withQuery("/owner/activity", filters, { page: String(page + 1) })} variant="secondary" size="sm">Older <ChevronRight className="h-4 w-4" aria-hidden /></LinkButton>}
          </nav>
        )}
      </Panel>
    </>
  );
}
