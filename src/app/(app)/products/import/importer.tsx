"use client";
import { CheckCircle2, FileSpreadsheet, ListChecks, Loader2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { A, Badge, Button, Callout, Check, Field, Input, Panel, Progress, Select, Table, Td, cx } from "@/components/ui";
import type { CommitResult, ImportField, ImportRecord, Mapping, Match } from "@/lib/import";

type Preview = { records: ImportRecord[]; matches: Match[]; products: Record<string, string> };
type Decision = string; // product id | "new" | "skip" | "" (needs a decision)
const API = "/products/import/api";
const CHUNK = 300;

async function call<T>(body: BodyInit, json = true): Promise<T> {
  const res = await fetch(API, { method: "POST", body, headers: json ? { "content-type": "application/json" } : undefined });
  const data = await res.json().catch(() => ({ error: "Something went wrong. Please try again." }));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as T;
}

export function Importer({ fields, suppliers, canStock, canPrice, currency }: {
  fields: Record<ImportField, string>; suppliers: { id: string; name: string }[]; canStock: boolean; canPrice: boolean; currency: string;
}) {
  const [step, setStep] = useState<"upload" | "map" | "review" | "done">("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<{ header: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [supplierId, setSupplierId] = useState("");
  const [openingStock, setOpeningStock] = useState(false);
  const [updatePrices, setUpdatePrices] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [filter, setFilter] = useState<"all" | "review" | "match" | "new" | "error">("all");
  const [limit, setLimit] = useState(200);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<CommitResult | null>(null);
  const fmt = (m: number | null) => (m === null ? "" : new Intl.NumberFormat("en", { style: "currency", currency }).format(m / 100));

  async function upload(fd: FormData) {
    setBusy(true); setError(null);
    try {
      const g = await call<{ header: string[]; rows: string[][]; mapping: Mapping }>(fd, false);
      setGrid(g);
      setMapping(g.mapping);
      setStep("map");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function runPreview() {
    if (!grid) return;
    setBusy(true); setError(null);
    try {
      const p = await call<Preview>(JSON.stringify({ step: "preview", rows: grid.rows, mapping, firstLine: 2 }));
      setPreview(p);
      setDecisions(p.records.map((r, i) => (r.errors.length ? "skip" : p.matches[i].status === "match" ? p.matches[i].productId! : p.matches[i].status === "new" ? "new" : "")));
      setFilter(p.matches.some((m) => m.status === "review") ? "review" : "all");
      setStep("review");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function commit() {
    if (!preview) return;
    const rows = preview.records.map((r, i) => ({ ...r, productId: decisions[i] === "new" ? null : decisions[i] })).filter((_, i) => decisions[i] !== "skip");
    setBusy(true); setError(null); setProgress(0);
    const total: CommitResult = { created: 0, updated: 0, supplierPrices: 0, batches: 0, priceChanges: 0, warnings: [] };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await call<CommitResult>(JSON.stringify({ step: "commit", rows: rows.slice(i, i + CHUNK), supplierId: supplierId || null, openingStock, updatePrices }));
        for (const k of ["created", "updated", "supplierPrices", "batches", "priceChanges"] as const) total[k] += r[k];
        total.warnings.push(...r.warnings);
        setProgress(Math.min(100, ((i + CHUNK) / rows.length) * 100));
      }
      setResult(total); setStep("done");
    } catch (e) {
      setError(`${(e as Error).message}${total.created + total.updated ? ` (rows before this batch were saved: ${total.created} new, ${total.updated} updated)` : ""}`);
    } finally { setBusy(false); }
  }

  const counts = useMemo(() => {
    if (!preview) return null;
    const c = { all: preview.records.length, review: 0, match: 0, new: 0, error: 0 };
    preview.records.forEach((r, i) => { if (r.errors.length) c.error++; else c[preview.matches[i].status]++; });
    return c;
  }, [preview]);
  const undecided = decisions.filter((d) => d === "").length;
  const visible = preview ? preview.records.map((r, i) => i).filter((i) => {
    const r = preview.records[i], m = preview.matches[i];
    return filter === "all" || (filter === "error" ? r.errors.length > 0 : !r.errors.length && m.status === filter);
  }) : [];
  const setAll = (pick: (i: number) => Decision | null) => setDecisions((ds) => ds.map((d, i) => pick(i) ?? d));

  return (
    <div className="space-y-6">
      {error && <Callout tone="red">{error}</Callout>}

      {step === "upload" && (
        <Panel title="Choose a file" eyebrow="Step 1 of 3" icon={<Upload />}>
          <form action={upload} className="space-y-4">
            <Field label="CSV or Excel (.xlsx) file" hint="First row must be column headings. Up to 10,000 rows.">
              <Input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} className="py-2" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Supplier (for a price list)" hint="Costs are saved as this supplier's prices">
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">No supplier — it&apos;s our own stock list</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <div className="space-y-3 self-end pb-1">
                {canStock && <Check label="Add the quantities as opening stock at this branch" checked={openingStock} onChange={(e) => setOpeningStock(e.target.checked)} />}
                {canPrice && <Check label="Update selling prices of matched products" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} />}
              </div>
            </div>
            <div className="flex justify-end"><Button disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}Read file</Button></div>
          </form>
        </Panel>
      )}

      {step === "map" && grid && (
        <Panel title="Which column is which?" eyebrow={`Step 2 of 3 · ${fileName} · ${grid.rows.length} rows`} icon={<ListChecks />}>
          <p className="mb-4 text-sm text-muted">We guessed from the headings. Fix anything that&apos;s wrong; leave a field empty if the file doesn&apos;t have it.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(fields) as ImportField[]).filter((f) => openingStock || !["batchNo", "expiry", "qty"].includes(f)).map((f) => (
              <Field key={f} label={fields[f]}>
                <Select value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                  <option value="">— not in file —</option>
                  {grid.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="mt-6">
            <Table head={grid.header.map((h, i) => <span key={i} className={cx(Object.values(mapping).includes(i) ? "text-accent" : "")}>{h || `Column ${i + 1}`}</span>)}>
              {grid.rows.slice(0, 5).map((r, i) => <tr key={i}>{grid.header.map((_, j) => <Td key={j} className="text-muted">{r[j] ?? ""}</Td>)}</tr>)}
            </Table>
          </div>
          <div className="mt-6 flex justify-between">
            <Button type="button" variant="ghost" onClick={() => setStep("upload")}>Back</Button>
            <Button type="button" onClick={runPreview} disabled={busy || mapping.name === undefined}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Match to my products</Button>
          </div>
        </Panel>
      )}

      {step === "review" && preview && counts && (
        <Panel title="Check the matches" eyebrow="Step 3 of 3" icon={<ListChecks />}
          actions={<>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAll((i) => preview.matches[i].status === "review" && !preview.records[i].errors.length ? preview.matches[i].productId : null)}>Use all suggestions</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setAll((i) => decisions[i] === "" ? "new" : null)}>Make undecided new</Button>
          </>}>
          <div className="mb-4 flex flex-wrap gap-1">
            {([["all", "All"], ["review", "Needs a look"], ["match", "Matched"], ["new", "New products"], ["error", "Problems"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setFilter(k); setLimit(200); }} className={cx("rounded-xl px-3 py-1.5 text-sm font-medium", filter === k ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}>
                {l} <span className="ml-1 text-xs tabular-nums text-subtle">{counts[k]}</span>
              </button>
            ))}
          </div>
          <Table head={["Row", "In the file", "Cost", "Price", ...(openingStock ? ["Stock"] : []), "Match", "Use"]} empty="Nothing in this group">
            {visible.slice(0, limit).map((i) => {
              const r = preview.records[i], m = preview.matches[i], d = decisions[i];
              const opts = [...new Set([m.productId, ...m.candidates.map((c) => c.id)].filter((x): x is string => !!x))];
              return (
                <tr key={i} className={d === "" ? "bg-warn/5" : undefined}>
                  <Td className="font-mono text-xs text-muted">{r.line}</Td>
                  <Td className="max-w-72 whitespace-normal">
                    <span className="font-medium">{r.name || "—"}</span> <span className="text-xs text-muted">{[r.strength, r.form, r.packSize && `×${r.packSize}`, r.barcode].filter(Boolean).join(" · ")}</span>
                    {r.errors.map((e) => <span key={e} className="block text-xs text-bad">{e}</span>)}
                  </Td>
                  <Td className="tabular-nums">{fmt(r.costMinor)}</Td>
                  <Td className="tabular-nums">{fmt(r.priceMinor)}</Td>
                  {openingStock && <Td className="text-xs">{r.qty ? <>{r.qty} <span className="text-muted">{[r.batchNo, r.expiry].filter(Boolean).join(" · ")}</span></> : ""}</Td>}
                  <Td>{r.errors.length ? <Badge tone="red">Problem</Badge> : m.status === "match" ? <Badge tone="green">{m.via === "barcode" ? "Barcode" : `${Math.round(m.score * 100)}%`}</Badge> : m.status === "review" ? <Badge tone="yellow">{Math.round(m.score * 100)}% — check</Badge> : <Badge tone="blue">New</Badge>}</Td>
                  <Td>
                    <Select value={d} onChange={(e) => setDecisions((ds) => ds.map((x, j) => (j === i ? e.target.value : x)))} className="h-9 w-72 text-xs" aria-label={`What to do with row ${r.line}`} disabled={r.errors.length > 0}>
                      <option value="">Choose…</option>
                      {opts.map((id) => <option key={id} value={id}>{preview.products[id]}{m.candidates.find((c) => c.id === id) ? ` (${Math.round(m.candidates.find((c) => c.id === id)!.score * 100)}%)` : ""}</option>)}
                      <option value="new">Create a new product</option>
                      <option value="skip">Skip this row</option>
                    </Select>
                  </Td>
                </tr>
              );
            })}
          </Table>
          {visible.length > limit && <div className="mt-3 text-center"><Button type="button" variant="ghost" size="sm" onClick={() => setLimit((l) => l + 500)}>Show more ({visible.length - limit} left)</Button></div>}
          {busy && <div className="mt-4 space-y-1"><Progress value={progress} /><p className="text-xs text-muted">Importing… {Math.round(progress)}%</p></div>}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep("map")} disabled={busy}>Back</Button>
            <span className="text-sm text-muted">{undecided ? `${undecided} row${undecided === 1 ? "" : "s"} still need a decision` : `${decisions.filter((x) => x !== "skip").length} rows ready`}</span>
            <Button type="button" onClick={commit} disabled={busy || undecided > 0}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Import</Button>
          </div>
        </Panel>
      )}

      {step === "done" && result && (
        <Panel title="Import finished" icon={<CheckCircle2 />} glow>
          <p className="text-sm text-fg">{result.created} new product{result.created === 1 ? "" : "s"}, {result.updated} updated, {result.supplierPrices} supplier prices, {result.batches} opening batches, {result.priceChanges} price changes.</p>
          {result.warnings.length > 0 && (
            <details className="mt-4 text-sm"><summary className="cursor-pointer text-warn">{result.warnings.length} row{result.warnings.length === 1 ? "" : "s"} need attention</summary>
              <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto text-muted">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          <div className="mt-6 flex gap-3"><A href="/products">Go to products</A><button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => { setStep("upload"); setPreview(null); setGrid(null); setResult(null); }}>Import another file</button></div>
        </Panel>
      )}
    </div>
  );
}
