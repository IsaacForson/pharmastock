"use client";
// Offline outbox: ops saved on this device (IndexedDB) and replayed to /api/offline/sync in order.
// The same database keeps the till's catalogue snapshot, so signing out wipes both.
import type { OpResult, OutboxOp } from "@/app/api/offline/sync/ops";
import type { PosCatalog } from "@/lib/pos-catalog";

export type { OutboxOp };
export type StoredOp = OutboxOp & { id: number; queuedAt: number; status: "pending" | "rejected"; error?: string };

const DB = "pharmastock-outbox";
const STORE = "ops";
const CATALOG = "catalog";
export const OUTBOX_EVENT = "pharmastock:outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      if (!req.result.objectStoreNames.contains(CATALOG)) req.result.createObjectStore(CATALOG);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void, store = STORE): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

const changed = () => window.dispatchEvent(new Event(OUTBOX_EVENT));

/** All ops in queue order (pending and rejected). */
export async function listOps(): Promise<StoredOp[]> {
  return (await withStore<StoredOp[]>("readonly", (s) => s.getAll() as IDBRequest<StoredOp[]>)) ?? [];
}

/** Saves an op on this device. */
export async function queueOp(op: OutboxOp): Promise<void> {
  await withStore("readwrite", (s) => { s.add({ ...op, queuedAt: Date.now(), status: "pending" }); });
  changed();
}

/** The till's catalogue snapshot for a branch (null when this device has none yet). */
export async function loadCatalog(branchId: string): Promise<PosCatalog | null> {
  return (await withStore<PosCatalog>("readonly", (s) => s.get(branchId) as IDBRequest<PosCatalog>, CATALOG).catch(() => undefined)) ?? null;
}

export async function saveCatalog(c: PosCatalog): Promise<void> {
  await withStore("readwrite", (s) => { s.put(c, c.branchId); }, CATALOG);
}

export async function discardOp(id: number) {
  await withStore("readwrite", (s) => { s.delete(id); });
  changed();
}

let flushing: Promise<{ saved: number; pending: number }> | null = null;

/** Sends pending ops to the server. Saved ops are removed; refused ones stay (marked rejected) so nothing typed is lost. */
export function flush(): Promise<{ saved: number; pending: number }> {
  return (flushing ??= (async () => {
    try {
      const pending = (await listOps()).filter((o) => o.status === "pending");
      if (!pending.length || !navigator.onLine) return { saved: 0, pending: pending.length };
      const res = await fetch("/api/offline/sync", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ ops: pending.slice(0, 100) }), // server schema strips the local-only fields
      });
      if (!res.ok) return { saved: 0, pending: pending.length };
      const { results } = (await res.json()) as { results: OpResult[] };
      let saved = 0;
      await withStore("readwrite", (s) => {
        for (const r of results) {
          const op = pending.find((o) => o.id === r.id);
          if (!op || r.status === "retry") continue;
          if (r.status === "saved") saved++;
          const cur = s.get(r.id);
          cur.onsuccess = () => {
            if ((cur.result as StoredOp | undefined)?.queuedAt !== op.queuedAt) return;
            if (r.status === "saved") s.delete(r.id); else s.put({ ...op, status: "rejected", error: r.error });
          };
        }
      });
      changed();
      return { saved, pending: pending.length - saved };
    } catch {
      return { saved: 0, pending: (await listOps().catch(() => [])).filter((o) => o.status === "pending").length };
    } finally {
      flushing = null;
    }
  })());
}

/** Wipes locally cached pages, the outbox and the till catalogue (call on sign-out on shared devices). Returns ops that were still unsynced. */
export async function clearOfflineData(): Promise<number> {
  const unsynced = (await listOps().catch(() => [])).filter((o) => o.status === "pending").length;
  if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("ps-pages")) await caches.delete(k);
  await new Promise<void>((r) => { const req = indexedDB.deleteDatabase(DB); req.onsuccess = req.onerror = req.onblocked = () => r(); });
  changed();
  return unsynced;
}
