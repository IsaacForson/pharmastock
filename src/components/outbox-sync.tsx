"use client";
import { useCallback, useEffect, useState } from "react";
import { discardOp, flush, listOps, OUTBOX_EVENT, type StoredOp } from "@/lib/offline-client";

const amt = (minor: number | undefined) => ((minor ?? 0) / 100).toFixed(2);
const label = (o: StoredOp) => o.type === "sale"
  ? `Sale ${o.input.clientId.slice(-6).toUpperCase()} · ${amt(o.totalMinor)}`
  : `Account payment ${amt(o.amountMinor)}${o.customerName ? ` from ${o.customerName}` : ""} (${o.method.replace("_", " ")})`;

/** Replays the offline outbox when the connection returns and every 30s; shows what is still waiting. */
export function OutboxSync() {
  const [ops, setOps] = useState<StoredOp[]>([]);
  const [syncing, setSyncing] = useState(false);
  const refresh = useCallback(() => { listOps().then(setOps, () => setOps([])); }, []);
  const sync = useCallback(async () => {
    if (!("indexedDB" in window)) return;
    setSyncing(true);
    await flush();
    setSyncing(false);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!("indexedDB" in window)) return;
    const first = setTimeout(sync, 0);
    const timer = setInterval(sync, 30_000);
    window.addEventListener("online", sync);
    window.addEventListener(OUTBOX_EVENT, refresh);
    return () => { clearTimeout(first); clearInterval(timer); window.removeEventListener("online", sync); window.removeEventListener(OUTBOX_EVENT, refresh); };
  }, [sync, refresh]);

  const pending = ops.filter((o) => o.status === "pending");
  const rejected = ops.filter((o) => o.status === "rejected");
  if (!ops.length) return null;
  return (
    <div role="status" className={`fixed inset-x-3 bottom-3 z-50 border bg-solid/85 px-4 py-2.5 text-sm text-fg shadow-panel backdrop-blur-xl animate-rise sm:inset-x-auto sm:bottom-5 sm:right-5 sm:max-w-md print:hidden ${rejected.length ? "rounded-2xl border-bad/30" : "rounded-full border-warn/30"}`}>
      <div className="flex flex-wrap items-center gap-3">
        {pending.length > 0 && (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full bg-warn ${syncing ? "animate-pulse-ring text-warn" : ""}`} aria-hidden />
            {pending.length === 1 ? label(pending[0]) : `${pending.length} sales and payments`} saved on this device, waiting to sync.
          </span>
        )}
        {pending.length > 0 && <button type="button" onClick={sync} disabled={syncing} className="h-8 shrink-0 rounded-full bg-aurora px-3.5 text-xs font-medium text-on-accent shadow-glow transition hover:brightness-110 disabled:opacity-60">{syncing ? "Syncing…" : "Sync now"}</button>}
        {rejected.length > 0 && (
          <details className="w-full">
            <summary className="flex cursor-pointer items-center gap-2 font-medium text-bad"><span className="h-2 w-2 shrink-0 rounded-full bg-bad" aria-hidden />{rejected.length} sale{rejected.length === 1 ? "" : "s"} or payment{rejected.length === 1 ? "" : "s"} could not be saved — review</summary>
            <ul className="mt-3 max-h-[50vh] space-y-2 overflow-auto">
              {rejected.map((o) => (
                <li key={o.id} className="rounded-xl border border-bad/25 bg-bad/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><strong>{label(o)}</strong> <span className="text-muted">· {new Date(o.queuedAt).toLocaleString()}</span> — <span className="text-bad">{o.error}</span></span>
                    <button type="button" className="rounded-lg px-2 py-1 text-xs text-muted underline-offset-4 hover:bg-surface-2 hover:text-fg hover:underline" onClick={() => { if (window.confirm("Discard this change from this device? Copy anything you need first.")) discardOp(o.id); }}>Discard</button>
                  </div>
                  {o.type === "sale" && (
                    <p className="mt-1 text-xs text-muted">{o.input.lines.length} item{o.input.lines.length === 1 ? "" : "s"} sold {o.input.soldAt ? new Date(o.input.soldAt).toLocaleString() : ""}. Fix the cause (for example the customer or prescription) with a manager, then discard.</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
