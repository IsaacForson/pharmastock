import { Banknote, HandCoins, Settings2, Tag, Trophy, Undo2, Users, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { A, Avatar, Badge, EmptyState, IconTile, LinkButton, Panel, Table, Td, type Tone } from "@/components/ui";
import type { Role } from "@/db/schema";
import { audit, requireCtx, tx } from "@/lib/auth";
import { dateTime, money } from "@/lib/format";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { pct } from "../../reports/range";
import { pickBranch, resolvePeriod, withQuery } from "../lib";
import { team, type StaffRow } from "../queries";
import { ConsoleHeader } from "../ui";

export const metadata = { title: "Staff accountability · Owner console" };

/** Discount share of what the person sold at list price; above this it is flagged for a closer look. */
const DISCOUNT_FLAG_PCT = 5;

export default async function TeamPage({ searchParams }: PageProps<"/owner/team">) {
  const ctx = await requireCtx("admin.console");
  const sp = await searchParams;
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const fmt = (v: number) => money(v, cur);
  const period = resolvePeriod(sp.period, tz);
  const branch = pickBranch(sp.branch, ctx.branches.map((b) => b.id));
  const branchIds = branch ? [branch] : ctx.branches.map((b) => b.id);

  const staff = await tx(ctx, async (t) => {
    await audit(t, ctx, "view", "owner_console", null, { details: { page: "team", period: period.key, branch } });
    return team(t, { branchIds, period });
  });
  const active = staff.filter((s) => s.active);
  const discountPct = (s: StaffRow) => pct(s.discounts, s.revenue + s.discounts);
  const watch: { key: keyof StaffRow; label: string; icon: ReactNode; tone: Tone; show: (s: StaffRow) => string; type: string }[] = [
    { key: "discounts", label: "Discounts given", icon: <HandCoins />, tone: "yellow", show: (s) => `${fmt(s.discounts)} · ${s.discountedSales} sales`, type: "sales" },
    { key: "voids", label: "Sales voided", icon: <XCircle />, tone: "red", show: (s) => `${s.voids} · ${fmt(s.voidedValue)}`, type: "voids" },
    { key: "refunded", label: "Refunds given", icon: <Undo2 />, tone: "yellow", show: (s) => `${fmt(s.refunded)} · ${s.returns} returns`, type: "returns" },
    { key: "overrides", label: "Prices changed at the till", icon: <Tag />, tone: "purple", show: (s) => `${s.overrides} lines`, type: "prices" },
  ];
  const manage = can(ctx.user.role, "users.manage");
  const top = staff.filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0];

  return (
    <>
      <ConsoleHeader ctx={ctx} current="team" period={period.key} branch={branch}
        subtitle={`${active.length} active staff · who sold what, and who gave discounts, voids, refunds and price changes in ${period.label.toLowerCase()}`} />

      <div className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Watch list">
          {watch.map((l) => {
            const ranked = staff.filter((s) => Number(s[l.key]) > 0).sort((a, b) => Number(b[l.key]) - Number(a[l.key])).slice(0, 3);
            return (
              <Panel key={l.key} title={l.label} eyebrow="Most this period" icon={l.icon}>
                {ranked.length ? (
                  <ol className="space-y-3">
                    {ranked.map((s, i) => (
                      <li key={s.id}>
                        <a href={withQuery("/owner/activity", { user: s.id, type: l.type })} className="flex items-center gap-3 rounded transition hover:bg-surface-2">
                          <span className="w-4 text-xs font-semibold tabular-nums text-subtle">{i + 1}</span>
                          <Avatar name={s.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-fg">{s.name}</div>
                            <div className="truncate text-xs tabular-nums text-muted">{l.show(s)}</div>
                          </div>
                        </a>
                      </li>
                    ))}
                  </ol>
                ) : <EmptyState title="None this period" compact />}
              </Panel>
            );
          })}
        </section>

        <Panel title="Everyone" eyebrow={`${staff.length} accounts`} icon={<Users />}
          actions={manage && <LinkButton href="/settings/users" variant="secondary" size="sm"><Settings2 className="h-4 w-4" aria-hidden /> Manage staff</LinkButton>}>
          <Table head={["Name", "Role", "Sales", "Discounts", "Voids", "Refunds", "Price changes", "Stock adjustments", "Supervised", "Last sign-in"]} empty="No staff yet.">
            {staff.map((s) => (
              <tr key={s.id} className={s.active ? undefined : "opacity-50"}>
                <Td>
                  <span className="inline-flex items-center gap-3">
                    <Avatar name={s.name} size="sm" />
                    {manage ? <A href={`/settings/users/${s.id}`}>{s.name}</A> : <span className="font-medium">{s.name}</span>}
                    {top?.id === s.id && <IconTile tone="purple" className="h-6 w-6 [&>svg]:h-3 [&>svg]:w-3"><Trophy aria-label="Top seller" /></IconTile>}
                  </span>
                </Td>
                <Td className="text-muted">{ROLE_LABELS[s.role as Role] ?? s.role}</Td>
                <Td className="tabular-nums">{s.sales ? <>{fmt(s.revenue)} <span className="text-xs text-muted">· {s.sales}</span></> : <span className="text-subtle">—</span>}</Td>
                <Td className="tabular-nums">
                  {s.discounts ? <span className="inline-flex items-center gap-1.5">{fmt(s.discounts)}{discountPct(s) > DISCOUNT_FLAG_PCT && <Badge tone="yellow">{discountPct(s)}%</Badge>}</span> : <span className="text-subtle">—</span>}
                  <div className="text-[11px] text-subtle">limit {s.maxDiscountBp / 100}%</div>
                </Td>
                <Td className="tabular-nums">{s.voids ? <Badge tone="red">{s.voids} · {fmt(s.voidedValue)}</Badge> : <span className="text-subtle">—</span>}</Td>
                <Td className="tabular-nums">{s.returns ? <>{fmt(s.refunded)} <span className="text-xs text-muted">· {s.returns}</span></> : <span className="text-subtle">—</span>}</Td>
                <Td className="tabular-nums">{s.overrides ? <Badge tone="purple">{s.overrides}</Badge> : <span className="text-subtle">—</span>}</Td>
                <Td className="tabular-nums">{s.adjustments || <span className="text-subtle">—</span>}</Td>
                <Td className="tabular-nums">{s.supervised || <span className="text-subtle">—</span>}</Td>
                <Td className="text-muted tabular-nums">{s.lastLoginAt ? dateTime(s.lastLoginAt, tz) : "Never"}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-4 flex items-start gap-2 text-xs text-subtle"><Banknote className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Sales are by the cashier who rang them up at {branch ? "this branch" : "your branches"}; voids by who voided. A price change is a line sold at a different price from the shelf price at that time.
            Supervised = P/POM/controlled sales a pharmacist approved. Discounts above {DISCOUNT_FLAG_PCT}% of list are flagged.
          </p>
        </Panel>
      </div>
    </>
  );
}
