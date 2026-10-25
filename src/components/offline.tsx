"use client";
import { CloudOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { clearOfflineData, flush, listOps } from "@/lib/offline-client";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-warn/30 bg-warn/12 px-4 py-2 text-center text-sm text-fg print:hidden">
      <CloudOff className="h-4 w-4 shrink-0 text-warn" aria-hidden />
      <span><strong className="font-semibold text-warn">You are offline.</strong> The till keeps selling: sales and account payments are saved on this device and sync when you reconnect.</span>
    </div>
  );
}

/** Sign-out that first wipes cached pages and the offline outbox, so shared counter devices keep no customer data. */
export function SignOutButton({ action, className, children }: { action: () => Promise<void>; className?: string; children?: React.ReactNode }) {
  return (
    <form action={async () => {
      // Try to sync first; never silently drop a sale or payment saved offline.
      await flush().catch(() => {});
      const pending = (await listOps().catch(() => [])).filter((o) => o.status === "pending").length;
      if (pending && !window.confirm(`${pending} sale(s) or payment(s) saved offline have not synced yet and will be lost if you sign out. Sign out anyway?`)) return;
      await clearOfflineData().catch(() => 0);
      await action();
    }}>
      <button className={className ?? "text-muted transition hover:text-fg"}>{children ?? "Sign out"}</button>
    </form>
  );
}
