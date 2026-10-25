import { LoginForms } from "./login-forms";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <p className="text-[11px] font-mono uppercase tracking-wider text-accent-2">Welcome back</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em]">Sign in to your pharmacy</h1>
      <p className="mb-7 mt-1.5 text-sm text-muted">Pick up right where your team left off.</p>
      <LoginForms />
    </>
  );
}
