"use client";
import { Check, Copy, KeyRound } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

type State = { ok?: boolean; error?: string; message?: string; id?: string } | undefined;
type Action = (prev: State, fd: FormData) => Promise<State>;

/** "Label: SECRET — note" → parts. Actions that mint one-time secrets phrase their message this way. */
function splitSecret(msg: string) {
  const i = msg.indexOf(": ");
  if (i < 0) return null;
  const [secret, ...note] = msg.slice(i + 2).split(" — ");
  return secret && !/\s/.test(secret) ? { label: msg.slice(0, i), secret, note: note.join(" — ") } : null;
}

/** Copy-to-clipboard box for a secret shown exactly once. */
export function SecretReveal({ label, secret, note }: { label: string; secret: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="ring-aurora animate-rise space-y-3 rounded-2xl bg-surface-2 p-4 shadow-glow">
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <KeyRound className="h-4 w-4 text-accent" aria-hidden /> {label}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-canvas px-3 py-2.5">
        <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-accent-2">{secret}</code>
        <button type="button" onClick={() => { navigator.clipboard?.writeText(secret).then(() => setCopied(true), () => {}); }}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-xs font-medium text-fg transition hover:bg-surface-3">
          {copied ? <><Check className="h-3.5 w-3.5 text-ok" aria-hidden /> Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden /> Copy</>}
        </button>
      </div>
      <p className="text-xs text-warn">{note || "Copy it now — it won't be shown again."}</p>
    </div>
  );
}

/** Like ActionForm, but a success message carrying a one-time secret renders as a reveal box with copy. */
export function SecretActionForm({ action, children, className, resetOnSuccess }: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean }) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); }, [state, resetOnSuccess]);
  const s = state?.ok && state.message ? splitSecret(state.message) : null;
  return (
    <form ref={ref} action={formAction} className={cx("space-y-4", className)}>
      {children}
      {state?.error && <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad animate-rise">{state.error}</p>}
      {state?.ok && state.message && (s
        ? <SecretReveal {...s} />
        : <p role="status" className="rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2.5 text-sm text-ok animate-rise">{state.message}</p>)}
    </form>
  );
}
