import { ShieldHalf } from "lucide-react";
import { LogoMark } from "../(app)/nav";

/** Centered card for the PharmaStock team sign-in steps. */
export function AdminAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="page-bg flex min-h-screen flex-col text-fg">
      <header className="bg-header text-on-header">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-2.5 px-4">
          <LogoMark /><span className="text-[14px] font-semibold">PharmaStock</span>
          <span className="flex items-center gap-1 rounded-sm border border-accent-2/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-2"><ShieldHalf className="h-3 w-3" />Control · team only</span>
        </div>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="sheet w-full max-w-[420px] border-t-[3px] border-t-accent p-8">{children}</div>
        <p className="mt-5 max-w-sm text-center text-xs text-subtle">Every action in Control is recorded in the platform audit log.</p>
      </div>
    </main>
  );
}
