import { Check } from "lucide-react";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input, Select } from "@/components/ui";
import { COUNTRIES } from "@/lib/provision";
import { signupAction } from "../actions";

export const metadata = { title: "Start your trial" };
const LAUNCH = ["GH", "NG", "KE"];

const PERKS = ["No card needed", "Every feature for 30 days", "Export your data any time"];

export default function SignupPage() {
  return (
    <>
      <p className="text-[11px] font-mono uppercase tracking-wider text-accent-2">30-day free trial</p>
      <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.02em]">Set up your pharmacy</h1>
      <ul className="mb-7 mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {PERKS.map((p) => <li key={p} className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-ok" aria-hidden />{p}</li>)}
      </ul>
      <ActionForm action={signupAction} className="space-y-4">
        <Field label="Pharmacy name"><Input name="pharmacyName" placeholder="e.g. Grace Community Pharmacy" required autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input name="ownerName" autoComplete="name" placeholder="Ama Mensah" required /></Field>
          <Field label="Country">
            <Select name="country" defaultValue="GH">
              <optgroup label="Launch markets">{LAUNCH.map((code) => <option key={code} value={code}>{COUNTRIES[code].name}</option>)}</optgroup>
              <optgroup label="Other countries">{Object.entries(COUNTRIES).filter(([code]) => !LAUNCH.includes(code)).map(([code, c]) => <option key={code} value={code}>{c.name}</option>)}</optgroup>
            </Select>
          </Field>
          <Field label="Email" hint="Email or phone — you sign in with either"><Input name="email" type="email" autoComplete="email" /></Field>
          <Field label="Phone"><Input name="phone" type="tel" autoComplete="tel" placeholder="024 123 4567" /></Field>
        </div>
        <Field label="Password" hint="At least 10 characters"><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <label className="flex items-start gap-2.5 text-xs leading-relaxed text-muted">
          <input type="checkbox" name="terms" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" required />
          <span>I agree to the <Link href="/terms" className="text-accent hover:underline">terms</Link> and <Link href="/privacy" className="text-accent hover:underline">privacy policy</Link>. PharmaStock supports, but does not replace, pharmacist judgment.</span>
        </label>
        <Submit size="lg" className="w-full">Create my pharmacy</Submit>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted">Already have an account? <Link href="/login" className="font-medium text-accent hover:underline underline-offset-4">Sign in</Link></p>
    </>
  );
}
