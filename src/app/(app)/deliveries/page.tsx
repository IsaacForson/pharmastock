import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { Bike, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/form";
import { Badge, EmptyState, PageHeader, StatusDot, type Tone } from "@/components/ui";
import { customers, deliveries, sales } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { addDays, dayRange, localDay, money, timeOnly } from "@/lib/format";
import { hasFeature } from "@/lib/plans";
import { deliveryStatusAction, notifyDeliveryAction } from "./actions";

export const metadata = { title: "Deliveries" };

const LANES: { key: string; label: string; tone: Tone }[] = [
  { key: "pending", label: "To send", tone: "yellow" }, { key: "out", label: "Out for delivery", tone: "blue" },
  { key: "delivered", label: "Delivered", tone: "green" }, { key: "failed", label: "Failed", tone: "red" },
];
const NEXT: Record<string, { to: string; label: string; variant?: "primary" | "secondary" | "danger" | "ghost" }[]> = {
  pending: [{ to: "out", label: "Send out", variant: "primary" }, { to: "cancelled", label: "Cancel", variant: "ghost" }],
  out: [{ to: "delivered", label: "Delivered", variant: "primary" }, { to: "failed", label: "Failed", variant: "danger" }],
  failed: [{ to: "out", label: "Try again" }, { to: "cancelled", label: "Cancel", variant: "ghost" }],
  delivered: [],
};

export default async function DeliveriesPage() {
  const ctx = await requireCtx("deliveries.manage");
  if (!hasFeature(ctx.tenant, "delivery")) redirect("/settings/subscription");
  const tz = ctx.tenant.timezone, cur = ctx.tenant.currency;
  const since = dayRange(addDays(localDay(tz), -2), tz).start;
  const rows = await tx(ctx, (t) => t.select({ d: deliveries, saleNo: sales.saleNo, total: sales.totalMinor, customer: customers.name }).from(deliveries)
    .leftJoin(sales, eq(sales.id, deliveries.saleId)).leftJoin(customers, eq(customers.id, deliveries.customerId))
    .where(and(eq(deliveries.branchId, ctx.branchId), or(inArray(deliveries.status, ["pending", "out", "failed"]), gte(deliveries.createdAt, since))))
    .orderBy(desc(deliveries.createdAt)).limit(200));
  const write = ctx.access === "full";
  return (
    <div>
      <PageHeader title="Deliveries" eyebrow="Counter" icon={<Bike />} subtitle="Orders going out to customers. Create one from a sale's page." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {LANES.map((lane) => {
          const items = rows.filter((r) => r.d.status === lane.key);
          return (
            <section key={lane.key} className="sheet min-h-64 p-3">
              <header className="mb-3 flex items-center justify-between px-1"><span className="flex items-center gap-2 text-sm font-semibold text-fg"><StatusDot tone={lane.tone} pulse={lane.key === "out"} />{lane.label}</span><Badge tone={lane.tone}>{items.length}</Badge></header>
              <div className="space-y-2">
                {items.map(({ d, saleNo, total, customer }) => (
                  <article key={d.id} className="rounded-md border border-line bg-surface-2 p-3 text-sm transitionhover:border-line-strong">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0"><div className="truncate font-medium text-fg">{customer ?? "Customer"}</div>{d.saleId && <Link href={`/sales/${d.saleId}`} className="font-mono text-xs text-accent hover:underline">{saleNo}</Link>}</div>
                      <span className="text-xs tabular-nums text-muted">{money(total ?? 0, cur)}</span>
                    </div>
                    <p className="mt-2 flex gap-1.5 text-xs text-muted"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{d.address}</p>
                    {d.phone && <a href={`tel:${d.phone}`} className="mt-1 flex items-center gap-1.5 text-xs text-accent"><Phone className="h-3.5 w-3.5" aria-hidden />{d.phone}</a>}
                    <p className="mt-1 text-xs text-subtle">{[d.rider && `Rider ${d.rider}`, d.feeMinor ? `Fee ${money(d.feeMinor, cur)}` : null, `Created ${timeOnly(d.createdAt, tz)}`, d.notes].filter(Boolean).join(" · ")}</p>
                    {write && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(NEXT[d.status] ?? []).map((n) => <ActionButton key={n.to} action={deliveryStatusAction} fields={{ id: d.id, status: n.to }} variant={n.variant ?? "secondary"}>{n.label}</ActionButton>)}
                        {d.customerId && <ActionButton action={notifyDeliveryAction} fields={{ id: d.id }} variant="ghost">Tell customer</ActionButton>}
                      </div>
                    )}
                  </article>
                ))}
                {!items.length && <EmptyState compact title="Nothing here" />}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
