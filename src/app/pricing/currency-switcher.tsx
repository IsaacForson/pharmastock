"use client";
import { Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { CURRENCIES, CURRENCY_NAMES } from "@/lib/countries";

/** Lets a visitor see prices in another currency (remembered for a year). */
export function CurrencySwitcher({ current }: { current: string }) {
  const router = useRouter();
  return (
    <label className="inline-flex items-center gap-2 rounded border border-line bg-surface px-3 py-1.5 text-xs text-muted">
      <Globe className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">Currency</span>
      <select defaultValue={current} aria-label="Show prices in"
        onChange={(e) => { document.cookie = `ps-currency=${e.target.value}; path=/; max-age=${365 * 86400}; samesite=lax`; router.refresh(); }}
        className="bg-transparent text-xs text-fg outline-none">
        {CURRENCIES.map((c) => <option key={c} value={c}>{c} · {CURRENCY_NAMES[c]}</option>)}
      </select>
    </label>
  );
}
