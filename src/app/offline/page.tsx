/* eslint-disable @next/next/no-html-link-for-pages -- full navigations are answered from the service worker cache while offline; <Link> would fetch RSC and fail */
import { CloudOff } from "lucide-react";
import { LogoMark } from "@/app/(app)/nav";
import { OutboxSync } from "@/components/outbox-sync";

export const metadata = { title: "Offline" };

const btn = "inline-flex h-10 items-center justify-center rounded px-4 text-sm font-medium transition";

export default function OfflinePage() {
  return (
    <main className="page-bg relative flex min-h-screen flex-col overflow-hidden">
      <OutboxSync />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="sheet mark-brand w-full p-8 text-center">
          <div className="relative mx-auto w-fit">
            <LogoMark className="h-14 w-14 rounded-md" />
            <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border border-line bg-solid text-warn" aria-hidden><CloudOff className="h-3.5 w-3.5" /></span>
          </div>
          <p className="mt-6 inline-flex items-center gap-2 rounded bg-warn/12 px-3 py-1 text-xs font-medium text-warn"><span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />No connection</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">You&apos;re offline</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This page hasn&apos;t been saved on this device yet. The till still works: sales you make now are kept on this device and sync
            automatically when the connection returns. Pages you opened recently are still available.
          </p>
          <nav aria-label="Available offline" className="mt-7 flex flex-wrap justify-center gap-2">
            <a href="/pos" className={`${btn} bg-brand text-on-accent hover:bg-accent-strong`}>Open the till</a>
            <a href="/dashboard" className={`${btn} border border-line bg-surface-2 text-fg hover:bg-surface-3`}>Dashboard</a>
            <a href="/products" className={`${btn} border border-line bg-surface-2 text-fg hover:bg-surface-3`}>Products</a>
          </nav>
        </div>
      </div>
    </main>
  );
}
