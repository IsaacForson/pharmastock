"use client";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { Badge, cx, Input, Panel, Select, Table, Td } from "@/components/ui";
import type { ForecastDetail } from "@/lib/forecast";
import type { ReorderSuggestion } from "@/lib/reorder";
import { createReorderPosAction } from "../actions";
import { toMinor } from "../status";

type Quote = { supplierId: string; productId: string; unitId: string; costMinor: number; factor: number; unitName: string; updatedAt: string };
type Unit = { id: string; productId: string; name: string; factor: number };
type Row = { on: boolean; supplierId: string; unitId: string; qty: string; cost: string };

const REASON: Record<ReorderSuggestion["reason"], { label: string; tone: "red" | "yellow" | "blue" }> = {
  out_of_stock: { label: "Out of stock", tone: "red" }, below_reorder_level: { label: "Below reorder level", tone: "yellow" }, low_cover: { label: "Running low", tone: "blue" },
};

export function ReorderTable({ rows, details, quotes, units, suppliers, currency, filterSupplier }: {
  rows: ReorderSuggestion[]; details: ForecastDetail[]; quotes: Quote[]; units: Unit[]; suppliers: { id: string; name: string }[]; currency: string; filterSupplier?: string;
}) {
  const fmt = (m: number) => new Intl.NumberFormat("en", { style: "currency", currency }).format(m / 100);
  const nameOf = (id: string) => suppliers.find((s) => s.id === id)?.name ?? "Supplier";
  const quotesFor = (pid: string) => quotes.filter((q) => q.productId === pid).sort((a, b) => a.costMinor / a.factor - b.costMinor / b.factor);
  const [state, setState] = useState<Record<string, Row>>(() => Object.fromEntries(rows.map((r) => [r.productId, {
    on: !!r.supplierId, supplierId: r.supplierId ?? "", unitId: r.unitId ?? "", qty: String(r.packs), cost: r.unitCostMinor != null ? (r.unitCostMinor / 100).toFixed(2) : "",
  }])));
  const [open, setOpen] = useState<string | null>(null);
  const set = (pid: string, p: Partial<Row>) => setState((s) => ({ ...s, [pid]: { ...s[pid], ...p } }));

  /** Switch supplier: use that supplier's quoted pack and price, converting the quantity to keep the same base units. */
  const pickSupplier = (r: ReorderSuggestion, supplierId: string, unitId?: string) => {
    const q = quotesFor(r.productId).find((x) => x.supplierId === supplierId && (!unitId || x.unitId === unitId));
    const cur = state[r.productId];
    const curF = units.find((u) => u.id === cur.unitId)?.factor ?? 1;
    if (!q) return set(r.productId, { supplierId, on: !!supplierId });
    const base = (Number(cur.qty) || 0) * curF;
    set(r.productId, { supplierId, on: true, unitId: q.unitId, cost: (q.costMinor / 100).toFixed(2), qty: String(Math.max(1, Math.ceil(base / q.factor))) });
  };

  const chosen = rows.filter((r) => state[r.productId].on);
  const lines = chosen.map((r) => { const s = state[r.productId]; return { supplierId: s.supplierId, productId: r.productId, unitId: s.unitId, qty: Math.floor(Number(s.qty) || 0), unitCostMinor: toMinor(s.cost || "0") ?? 0 }; });
  const groups = new Set(lines.map((l) => l.supplierId).filter(Boolean)).size;
  const total = lines.reduce((s, l) => s + l.qty * l.unitCostMinor, 0);
  const missing = lines.filter((l) => !l.supplierId || l.qty < 1).length;

  return (
    <ActionForm action={createReorderPosAction} className="space-y-4">
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <Panel title="Suggestions" eyebrow={filterSupplier ? `For ${nameOf(filterSupplier)}` : "All suppliers"}
        actions={<div className="flex items-center gap-3"><span className="hidden text-sm text-muted sm:inline">{chosen.length} ticked · {groups} supplier{groups === 1 ? "" : "s"} · <span className="tabular-nums text-fg">{fmt(total)}</span></span>
          <Submit disabled={!chosen.length || missing > 0}>Create {groups || ""} draft order{groups === 1 ? "" : "s"}</Submit></div>}>
        {missing > 0 && <p className="mb-3 text-sm text-warn">{missing} ticked line{missing === 1 ? " needs" : "s need"} a supplier and a quantity.</p>}
        <Table head={["", "Product", "Why", "Stock", "Demand", "Forecast", "Supplier", "Order", "Cost per pack", ""]} empty="Nothing to reorder right now. Stock covers expected sales.">
          {rows.map((r) => {
            const s = state[r.productId];
            const fd = details.find((x) => x.productId === r.productId);
            const qs = quotesFor(r.productId);
            const cheapest = qs[0];
            const pUnits = units.filter((u) => u.productId === r.productId);
            const isOpen = open === r.productId;
            return (
              <Fragment key={r.productId}>
                <tr className={cx(!s.on && "opacity-60")}>
                  <Td><input type="checkbox" aria-label={`Order ${r.name}`} checked={s.on} onChange={(e) => set(r.productId, { on: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /></Td>
                  <Td className="max-w-56"><div className="truncate font-medium">{r.name}{r.strength && <span className="text-muted"> {r.strength}</span>}</div></Td>
                  <Td><Badge tone={REASON[r.reason].tone}>{REASON[r.reason].label}</Badge></Td>
                  <Td className="tabular-nums text-muted">{r.onHand} {r.baseUnit}{r.onOrder > 0 && <div className="text-xs">+{r.onOrder} on order</div>}</Td>
                  <Td className="tabular-nums text-muted">{r.dailyDemand.toFixed(1)}/day{r.daysOfCover !== null && <div className="text-xs">{Math.floor(r.daysOfCover)} days left</div>}</Td>
                  <Td className="text-xs">
                    {fd && fd.factor !== 1 ? <Badge tone={fd.factor > 1 ? "yellow" : "teal"}>{fd.factor > 1 ? "+" : ""}{Math.round((fd.factor - 1) * 100)}%</Badge> : <span className="text-subtle">—</span>}
                    {fd && <div className="mt-1 text-muted" title="Expected this month vs sold in the last 30 days">{Math.round(fd.monthlyAverage * fd.factor)} expected · {fd.last30Days} sold last 30d</div>}
                  </Td>
                  <Td>
                    <Select aria-label="Supplier" value={s.supplierId} className="h-9 min-w-40" onChange={(e) => pickSupplier(r, e.target.value)}>
                      <option value="">Choose…</option>
                      {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}{cheapest?.supplierId === x.id ? " (cheapest)" : ""}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Input aria-label="Packs" type="number" min={1} value={s.qty} onChange={(e) => set(r.productId, { qty: e.target.value })} className="h-9 w-20 tabular-nums" />
                      <Select aria-label="Pack" value={s.unitId} className="h-9 min-w-28" onChange={(e) => { const q = qs.find((x) => x.supplierId === s.supplierId && x.unitId === e.target.value); set(r.productId, { unitId: e.target.value, ...(q ? { cost: (q.costMinor / 100).toFixed(2) } : {}) }); }}>
                        {pUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </Select>
                    </div>
                  </Td>
                  <Td><Input aria-label="Cost per pack" inputMode="decimal" value={s.cost} placeholder="0.00" onChange={(e) => set(r.productId, { cost: e.target.value })} className="h-9 w-24 tabular-nums" /></Td>
                  <Td>
                    <button type="button" onClick={() => setOpen(isOpen ? null : r.productId)} disabled={!qs.length} aria-expanded={isOpen}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent disabled:text-subtle">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}{qs.length} price{qs.length === 1 ? "" : "s"}
                    </button>
                  </Td>
                </tr>
                {isOpen && (
                  <tr className="bg-surface-2">
                    <td colSpan={10} className="px-5 py-3">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-subtle">Compare prices (per {r.baseUnit})</div>
                      <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {qs.map((q, i) => (
                          <li key={q.supplierId + q.unitId}>
                            <button type="button" onClick={() => pickSupplier(r, q.supplierId, q.unitId)}
                              className={cx("flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left text-sm transition hover:border-line-strong", i === 0 ? "border-ok/40 bg-ok/10" : "border-line bg-surface", s.supplierId === q.supplierId && s.unitId === q.unitId && "mark-brand")}>
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-fg">{nameOf(q.supplierId)}</span>
                                <span className="block text-xs text-muted">{fmt(q.costMinor)} per {q.unitName} · {new Date(q.updatedAt).toLocaleDateString("en-GB")}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                <span className="block tabular-nums text-fg">{fmt(q.costMinor / q.factor)}</span>
                                {i === 0 ? <Badge tone="green">Cheapest</Badge> : <span className="text-xs text-bad">+{Math.round(((q.costMinor / q.factor) / (cheapest.costMinor / cheapest.factor) - 1) * 100)}%</span>}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {fd && <p className="mt-3 text-xs text-muted">Forecast: {fd.label ?? "recent sales only"}. Same month last year: {fd.lastYearSameMonth} {r.baseUnit} · monthly average: {Math.round(fd.monthlyAverage)} · last 30 days: {fd.last30Days}.</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </Table>
      </Panel>
    </ActionForm>
  );
}
