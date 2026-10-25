import { ActionForm, Submit } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { adminLoginAction } from "../auth-actions";
import { AdminAuthShell } from "../auth-shell";

export const metadata = { title: "Control sign in", robots: { index: false } };

export default function AdminLoginPage() {
  return (
    <AdminAuthShell>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-muted">PharmaStock team members only.</p>
      <ActionForm action={adminLoginAction} className="space-y-4">
        <Field label="Work email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
        <Submit size="lg" className="w-full">Continue</Submit>
      </ActionForm>
    </AdminAuthShell>
  );
}
