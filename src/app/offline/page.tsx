/* eslint-disable @next/next/no-html-link-for-pages -- full navigations are answered from the service worker cache while offline; <Link> would fetch RSC and fail */
import { CloudOff } from "lucide-react";
import { LogoMark } from "@/app/(app)/nav";
import { OutboxSync } from "@/components/outbox-sync";

export const metadata = { title: "Offline" };

const btn = "inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium transition";

export default function OfflinePage() {
  return (
    <main className="backdrop-os relative flex min-h-screen flex-col overflow-hidden">
      <OutboxSync />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-accent/20 blur-[100px]" aria-hidden />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="glass ring-aurora w-full animate-rise p-8 text-center">
          <div className="relative mx-auto w-fit">
            <LogoMark className="h-14 w-14 rounded-2xl" />
            <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full border border-line bg-solid text-warn" aria-hidden><CloudOff className="h-3.5 w-3.5" /></span>
          </div>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-warn/12 px-3 py-1 text-xs font-medium text-warn"><span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />No connection</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-fg">You&apos;re offline</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This page hasn&apos;t been saved on this device yet. The till still works: sales you make now are kept on this device and sync
            automatically when the connection returns. Pages you opened recently are still available.
          </p>
          <nav aria-label="Available offline" className="mt-7 flex flex-wrap justify-center gap-2">
            <a href="/pos" className={`${btn} bg-aurora text-on-accent shadow-glow hover:brightness-110`}>Open the till</a>
            <a href="/dashboard" className={`${btn} border border-line bg-surface-2 text-fg hover:bg-surface-3`}>Dashboard</a>
            <a href="/products" className={`${btn} border border-line bg-surface-2 text-fg hover:bg-surface-3`}>Products</a>
          </nav>
        </div>
      </div>
    </main>
  );
}
