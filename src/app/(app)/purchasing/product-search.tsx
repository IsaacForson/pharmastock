"use client";
import { Search } from "lucide-react";
import { useMemo, useRef, useState, type RefObject } from "react";
import { cx, Input } from "@/components/ui";
import { CameraScanner, useWedgeScanner } from "@/components/scanner";
import type { CatalogItem } from "./catalog";

export const itemLabel = (p: Pick<CatalogItem, "name" | "strength" | "form">) => [p.name, p.strength, p.form].filter(Boolean).join(" ");

/** Scan or type to find a product. Enter picks the highlighted match; a barcode picks the product and its pack. */
export function ProductSearch({ catalog, onPick, inputRef, autoFocus, placeholder = "Scan a barcode or search by name" }: {
  catalog: CatalogItem[]; onPick: (item: CatalogItem, unitId?: string) => void; inputRef?: RefObject<HTMLInputElement | null>; autoFocus?: boolean; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const byCode = useMemo(() => new Map(catalog.flatMap((p) => p.codes.map((c) => [c.code, { p, unitId: c.unitId }] as const))), [catalog]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return catalog.filter((p) => `${p.name} ${p.genericName ?? ""} ${p.strength ?? ""}`.toLowerCase().includes(s)).slice(0, 8);
  }, [q, catalog]);

  const pickCode = (code: string) => {
    const m = byCode.get(code.trim());
    if (!m) return false;
    onPick(m.p, m.unitId);
    setQ("");
    return true;
  };
  useWedgeScanner((code) => { pickCode(code); });

  const pick = (p: CatalogItem) => { onPick(p); setQ(""); setHi(0); };
  return (
    <div className="relative flex gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
        <Input ref={ref} value={q} autoFocus={autoFocus} placeholder={placeholder} aria-label="Find a product" className="h-12 pl-10 text-base"
          role="combobox" aria-expanded={hits.length > 0} aria-controls="product-hits" autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); if (!pickCode(q) && hits[hi]) pick(hits[hi]); }
            else if (e.key === "Escape") setQ("");
          }} />
        {hits.length > 0 && (
          <ul id="product-hits" role="listbox" className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-auto rounded-md border border-line bg-solid p-1.5 shadow-lift">
            {hits.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === hi}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setHi(i)}
                  className={cx("flex w-full items-center justify-between gap-3 rounded px-3 py-2.5 text-left text-sm", i === hi ? "bg-surface-3 text-fg" : "text-muted")}>
                  <span className="truncate font-medium text-fg">{itemLabel(p)}</span>
                  <span className="shrink-0 text-xs text-subtle">{p.genericName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <CameraScanner onCode={(c) => { if (!pickCode(c)) setQ(c); }} />
    </div>
  );
}
