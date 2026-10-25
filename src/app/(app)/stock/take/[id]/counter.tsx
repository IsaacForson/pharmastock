"use client";
import { PackageSearch, ScanLine, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CameraScanner, useWedgeScanner } from "@/components/scanner";
import { Badge, Button, cx, Field, Input, Kbd, Panel, Select } from "@/components/ui";
import { lookupAction, openProductAction, saveCountAction } from "../actions";
import type { CountTarget } from "../logic";

type Choice = { batchId: string } | { found: true };

/** Scan-and-count: scan or type → pick batch (or found stock) → enter packs + loose → Enter saves → back to scanning. */
export function Counter({ takeId, initial, today }: { takeId: string; initial: CountTarget | null; today: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<CountTarget | null>(initial);
  const [choices, setChoices] = useState<{ id: string; label: string }[]>([]);
  const [pick, setPick] = useState<Choice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scanRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);

  const show = (r: { error?: string; target?: CountTarget; choices?: { id: string; label: string }[] }) => {
    setError(r.error ?? null);
    setChoices(r.choices ?? []);
    if (r.target) {
      setTarget(r.target);
      const live = r.target.batches.filter((b) => b.qty > 0);
      setPick(live.length === 1 ? { batchId: live[0].id } : null);
    }
  };
  const lookup = useCallback((code: string) => start(async () => show(await lookupAction(takeId, code))), [takeId]);
  useWedgeScanner(lookup);
  useEffect(() => { if (pick) countRef.current?.focus(); }, [pick]);

  const [state, save] = useActionState(saveCountAction, undefined);
  // Reset the form when a count is saved (state adjusted during render, not in an effect).
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) { setTarget(null); setPick(null); setQ(""); }
  }
  useEffect(() => {
    if (!state?.ok) return;
    router.refresh();
    scanRef.current?.focus();
  }, [state, router]);

  const [packs, setPacks] = useState("");
  const [loose, setLoose] = useState("");
  const [unitId, setUnitId] = useState("");
  const unit = target?.units.find((u) => u.id === unitId) ?? target?.units.find((u) => u.factor > 1) ?? target?.units[0];
  const factor = unit?.factor ?? 1;
  const total = (Number(packs) || 0) * factor + (Number(loose) || 0);
  const [seen, setSeen] = useState({ target, pick });
  if (seen.target !== target || seen.pick !== pick) { setSeen({ target, pick }); setPacks(""); setLoose(""); setUnitId(""); }

  const batch = pick && "batchId" in pick ? target?.batches.find((b) => b.id === pick.batchId) : undefined;

  return (
    <Panel title="Count" icon={<ScanLine />} glow eyebrow="Scan a barcode or type a name">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) lookup(q); }}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input ref={scanRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan or type, then Enter" aria-label="Barcode or product name" className="h-12 pl-9 text-base" />
        </div>
        <Button type="submit" variant="secondary" size="lg" disabled={pending}>{pending ? "Looking…" : "Find"}</Button>
        <CameraScanner onCode={lookup} label="Camera" className="inline-flex h-12 items-center gap-2 rounded-2xl border border-line bg-surface-2 px-4 text-sm font-medium text-fg hover:bg-surface-3" />
      </form>
      {error && <p role="alert" className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">{error}</p>}
      {choices.length > 0 && (
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {choices.map((c) => (
            <li key={c.id}><button type="button" onClick={() => start(async () => show(await openProductAction(takeId, c.id)))} className="flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-left text-sm text-fg hover:bg-surface-3">
              <PackageSearch className="h-4 w-4 text-accent" aria-hidden />{c.label}</button></li>
          ))}
        </ul>
      )}

      {target && (
        <div className="mt-5 space-y-4 border-t border-line pt-5">
          <div className="text-base font-semibold text-fg">{[target.product.name, target.product.strength, target.product.form].filter(Boolean).join(" ")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {target.batches.map((b) => {
              const expired = !!b.expiry && b.expiry < today;
              const on = !!pick && "batchId" in pick && pick.batchId === b.id;
              return (
                <button key={b.id} type="button" onClick={() => setPick({ batchId: b.id })} aria-pressed={on}
                  className={cx("rounded-xl border px-3 py-2.5 text-left text-sm transition", on ? "border-accent bg-accent/15" : "border-line bg-surface-2 hover:bg-surface-3")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-fg">{b.batchNo || "No batch no."}</span>
                    <span className="flex gap-1">{expired && <Badge tone="red">Expired</Badge>}{b.quarantined && <Badge tone="yellow">Quarantined</Badge>}{b.counted !== null && <Badge tone="green">Counted {b.counted}</Badge>}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">Expiry {b.expiry ?? "none"} · system {b.qty} {target.product.baseUnit}</div>
                </button>
              );
            })}
            <button type="button" onClick={() => setPick({ found: true })} aria-pressed={!!pick && "found" in pick}
              className={cx("rounded-xl border border-dashed px-3 py-2.5 text-left text-sm transition", pick && "found" in pick ? "border-accent bg-accent/15" : "border-line-strong hover:bg-surface-2")}>
              <div className="font-medium text-fg">Found stock</div>
              <div className="mt-1 text-xs text-muted">A batch that isn&apos;t on the system</div>
            </button>
          </div>

          {pick && (
            <form action={save} className="space-y-4">
              <input type="hidden" name="takeId" value={takeId} />
              <input type="hidden" name="productId" value={target.product.id} />
              <input type="hidden" name="qty" value={total} />
              {"batchId" in pick ? <input type="hidden" name="batchId" value={pick.batchId} /> : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Batch no."><Input name="batchNo" placeholder="As printed on the pack" /></Field>
                  <Field label="Expiry"><Input name="expiry" type="date" /></Field>
                </div>
              )}
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                {factor > 1 || (target.units.length > 1) ? (
                  <>
                    <Field label="Packs">
                      <div className="flex gap-2">
                        <Input ref={countRef} inputMode="numeric" value={packs} onChange={(e) => setPacks(e.target.value.replace(/\D/g, ""))} className="h-12 text-lg tabular-nums" aria-label="Number of packs" />
                        {target.units.length > 1 && (
                          <Select value={unit?.id} onChange={(e) => setUnitId(e.target.value)} aria-label="Pack size" className="h-12 w-36">
                            {target.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.factor})</option>)}
                          </Select>
                        )}
                      </div>
                    </Field>
                    <Field label={`Loose ${target.product.baseUnit}`}>
                      <Input inputMode="numeric" value={loose} onChange={(e) => setLoose(e.target.value.replace(/\D/g, ""))} className="h-12 text-lg tabular-nums" />
                    </Field>
                  </>
                ) : (
                  <Field label={`Count (${target.product.baseUnit})`} className="sm:col-span-2">
                    <Input ref={countRef} inputMode="numeric" value={loose} onChange={(e) => setLoose(e.target.value.replace(/\D/g, ""))} className="h-12 text-lg tabular-nums" />
                  </Field>
                )}
                <div className="pb-3 text-sm text-muted">
                  = <span className="text-lg font-semibold tabular-nums text-fg">{total}</span> {target.product.baseUnit}
                  {batch && <span className="block text-xs">system {batch.qty} · {total - batch.qty >= 0 ? "+" : ""}{total - batch.qty}</span>}
                </div>
                <Button type="submit" size="lg">Save count</Button>
              </div>
              <p className="text-xs text-subtle">Press <Kbd>Enter</Kbd> to save and scan the next item. Counting a batch again replaces the earlier count.</p>
              {state?.error && <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">{state.error}</p>}
            </form>
          )}
        </div>
      )}
      {state?.ok && !target && <p role="status" className="mt-3 text-sm text-ok">Saved. Scan the next item.</p>}
    </Panel>
  );
}
