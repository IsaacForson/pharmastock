"use client";
import { ArrowRight, CornerDownLeft, Pill, Receipt, Search, UserRound, Zap, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui";
import { ICONS, type NavItem } from "./nav";

/** One hit from /api/search. */
export type SearchResult = { type: "product" | "customer" | "sale"; id: string; title: string; subtitle?: string | null; href: string };
type Action = { href: string; label: string };
type Kind = SearchResult["type"] | "page" | "action";
type Entry = { key: string; href: string; label: string; hint?: string; kind: Kind; icon?: keyof typeof ICONS };

const HIT: Record<SearchResult["type"], { label: string; icon: LucideIcon }> = {
  product: { label: "Products", icon: Pill }, customer: { label: "Customers", icon: UserRound }, sale: { label: "Sales", icon: Receipt },
};
const GROUP: Record<Kind, string> = { ...Object.fromEntries(Object.entries(HIT).map(([k, v]) => [k, v.label])) as Record<SearchResult["type"], string>, action: "Quick actions", page: "Go to" };
const isResult = (r: unknown): r is SearchResult => !!r && typeof r === "object" && (r as SearchResult).type in HIT && typeof (r as SearchResult).href === "string" && (r as SearchResult).href.startsWith("/");

/** ⌘K / Ctrl+K palette: product, customer and sale search, quick actions and page jumps. */
export function CommandPalette({ pages, actions, canSearch }: { pages: NavItem[]; actions: Action[]; canSearch: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { setOpen(false); setQ(""); setHits([]); setActive(0); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "/" && !open && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) { e.preventDefault(); setOpen(true); }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("ps:command", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("ps:command", onOpen); };
  }, [open]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 10); }, [open]);

  const term = q.trim();
  const searching = canSearch && term.length >= 2;
  useEffect(() => {
    if (!searching) return;
    const ctl = new AbortController();
    const id = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setHits((Array.isArray(d?.results) ? d.results : []).filter(isResult).slice(0, 12))).catch(() => {});
    }, 150);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [term, searching]);

  const entries = useMemo<Entry[]>(() => {
    const match = (s: string) => !term || s.toLowerCase().includes(term.toLowerCase());
    return [
      // Grouped by type (products first: the counter mostly looks up stock).
      ...(searching ? (["product", "customer", "sale"] as const).flatMap((k) => hits.filter((h) => h.type === k)) : [])
        .map((h) => ({ key: `${h.type}-${h.id}`, href: h.href, label: h.title, hint: h.subtitle ?? undefined, kind: h.type })),
      ...actions.filter((a) => match(a.label)).map((a) => ({ key: `a-${a.href}`, href: a.href, label: a.label, kind: "action" as const })),
      ...pages.filter((p) => match(p.label)).map((p) => ({ key: `n-${p.href}`, href: p.href, label: p.label, kind: "page" as const, icon: p.icon })),
    ];
  }, [term, searching, hits, actions, pages]);

  const go = (e?: Entry) => { if (!e) return; close(); router.push(e.href); };
  const sel = Math.min(active, Math.max(entries.length - 1, 0));

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-canvas/70 px-4 pt-[12vh] backdrop-blur-md print:hidden" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label="Search and commands" onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-line-strong bg-solid/95 shadow-panel backdrop-blur-2xl animate-rise ring-aurora">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="h-5 w-5 text-accent" aria-hidden />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, entries.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); go(entries[sel]); }
            }}
            placeholder={canSearch ? "Search products, customers or sale numbers… or jump to a page" : "Jump to a page or action…"}
            className="h-14 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle" aria-label="Search" />
          <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">esc</kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto p-2" role="listbox">
          {entries.map((e, idx) => {
            const Icon = e.kind === "action" ? Zap : e.kind === "page" ? (e.icon ? ICONS[e.icon] : ArrowRight) : HIT[e.kind].icon;
            const first = idx === 0 || entries[idx - 1].kind !== e.kind;
            return (
              <li key={e.key}>
                {first && <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-subtle">{GROUP[e.kind]}</div>}
                <button type="button" role="option" aria-selected={idx === sel} onMouseEnter={() => setActive(idx)} onClick={() => go(e)}
                  className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition", idx === sel ? "bg-surface-3 text-fg" : "text-muted")}>
                  <span className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-lg", e.kind in HIT ? "bg-accent/15 text-accent" : e.kind === "action" ? "bg-warn/15 text-warn" : "bg-surface-3 text-muted")}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.label}</span>
                    {e.hint && <span className="block truncate text-xs text-subtle">{e.hint}</span>}
                  </span>
                  {idx === sel && <CornerDownLeft className="h-4 w-4 text-subtle" aria-hidden />}
                </button>
              </li>
            );
          })}
          {entries.length === 0 && <li className="px-3 py-10 text-center text-sm text-muted">{searching ? "Nothing matches. Try a generic name, barcode, phone or sale number." : "Type to search."}</li>}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-surface px-5 py-2.5 text-[11px] text-subtle">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span><span><kbd className="font-mono">↵</kbd> open</span><span><kbd className="font-mono">⌘K</kbd> toggle</span>
        </div>
      </div>
    </div>
  );
}

/** Top-bar trigger that looks like a search field. */
export function CommandTrigger({ canSearch }: { canSearch: boolean }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("ps:command"))}
      className="group flex h-11 w-full max-w-lg items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-sm text-subtle backdrop-blur-xl transition hover:border-line-strong hover:bg-surface-2">
      <Search className="h-4 w-4 text-subtle group-hover:text-accent-2" aria-hidden />
      <span className="flex-1 truncate text-left">{canSearch ? "Search products, customers, sales…" : "Jump to…"}</span>
      <kbd className="hidden rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted sm:inline">⌘K</kbd>
    </button>
  );
}
