import { ShieldHalf } from "lucide-react";
import { LogoMark } from "../(app)/nav";

/** Centered card for the PharmaStock team sign-in steps. */
export function AdminAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="backdrop-os flex min-h-screen flex-col items-center justify-center px-4 py-12 text-fg">
      <div className="mb-8 flex items-center gap-3">
        <LogoMark className="h-10 w-10" />
        <div>
          <div className="text-lg font-semibold tracking-tight">PharmaStock <span className="text-aurora">Control</span></div>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-subtle"><ShieldHalf className="h-3 w-3" /> Team access only</div>
        </div>
      </div>
      <div className="glass ring-aurora w-full max-w-[420px] p-8 animate-rise">{children}</div>
      <p className="mt-6 max-w-sm text-center text-xs text-subtle">Every action in Control is recorded in the platform audit log.</p>
    </main>
  );
}
