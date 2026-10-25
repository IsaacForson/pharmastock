"use client";
import { ShieldCheck } from "lucide-react";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { verify2faAction } from "../../actions";

export default function TwoFactorPage() {
  return (
    <>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-aurora text-on-accent shadow-glow" aria-hidden><ShieldCheck className="h-6 w-6" /></span>
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.02em]">Two-factor check</h1>
      <p className="mb-7 mt-1.5 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={verify2faAction} className="space-y-4">
        <Field label="Authentication code">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required className="h-14 text-center font-mono text-2xl tracking-[0.6em]" />
        </Field>
        <Submit size="lg" className="w-full">Verify</Submit>
      </ActionForm>
    </>
  );
}
