import { ArrowLeft, ShieldAlert } from "lucide-react";
import { LinkButton } from "@/components/ui";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main className="backdrop-os relative grid min-h-screen place-items-center overflow-hidden px-4 py-16">
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-bad/10 blur-[100px]" aria-hidden />
      <div className="glass relative w-full max-w-md animate-rise p-8 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-bad/30 bg-bad/12 text-bad" aria-hidden><ShieldAlert className="h-6 w-6" /></span>
        <p className="mt-6 font-mono text-xs text-subtle">403 · Restricted</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg">You don&apos;t have access to this page</h1>
        <p className="mt-3 text-sm text-muted">Ask your pharmacy owner or manager to change your role if you need it.</p>
        <LinkButton href="/dashboard" variant="secondary" className="mt-7"><ArrowLeft className="h-4 w-4" aria-hidden />Back to dashboard</LinkButton>
      </div>
    </main>
  );
}
