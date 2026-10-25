"use client";
import { KeyRound, Smartphone } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { ActionForm, Submit } from "@/components/form";
import { cx, Field, Input } from "@/components/ui";
import { loginAction, requestOtpAction, verifyOtpAction } from "../actions";

export function LoginForms() {
  const [mode, setMode] = useState<"password" | "otp">("password");
  return (
    <>
      <div role="tablist" aria-label="Sign-in method" className="mb-6 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1">
        {([["password", "Password", KeyRound], ["otp", "Phone code", Smartphone]] as const).map(([m, label, Icon]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            className={cx("inline-flex h-9 items-center justify-center gap-2 rounded-xl text-sm font-medium transition", mode === m ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg")}>
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </button>
        ))}
      </div>
      {mode === "password" ? (
        <ActionForm action={loginAction} className="space-y-4">
          <Field label="Email or phone"><Input name="login" autoComplete="username" placeholder="you@pharmacy.com or 024 123 4567" required autoFocus /></Field>
          <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
          <Submit size="lg" className="w-full">Sign in</Submit>
        </ActionForm>
      ) : <OtpForm />}
      <p className="mt-6 text-center text-sm text-muted">New pharmacy? <Link href="/signup" className="font-medium text-accent hover:underline underline-offset-4">Start a free 30-day trial</Link></p>
    </>
  );
}

function OtpForm() {
  const [sent, request] = useActionState(requestOtpAction, undefined);
  const [phone, setPhone] = useState("");
  return (
    <div className="space-y-4">
      <form action={request} className="space-y-4">
        <Field label="Phone number" hint="We'll text you a 6-digit code."><Input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 123 4567" required autoFocus /></Field>
        <Submit variant={sent?.ok ? "secondary" : "primary"} size="lg" className="w-full">{sent?.ok ? "Send a new code" : "Send code"}</Submit>
        {sent?.error && <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">{sent.error}</p>}
        {sent?.message && <p role="status" className="rounded-xl border border-ok/30 bg-ok/10 px-3.5 py-2.5 text-sm text-ok">{sent.message}</p>}
      </form>
      {sent?.ok && (
        <ActionForm action={verifyOtpAction} className="space-y-4 border-t border-line pt-4">
          <input type="hidden" name="phone" value={phone} />
          <Field label="6-digit code">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="h-12 text-center font-mono text-xl tracking-[0.5em]" />
          </Field>
          <Submit size="lg" className="w-full">Verify and sign in</Submit>
        </ActionForm>
      )}
    </div>
  );
}
