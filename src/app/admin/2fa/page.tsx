import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { Suspense } from "react";
import { ActionForm, Submit } from "@/components/form";
import { Field, Input } from "@/components/ui";
import { totpUri } from "@/lib/crypto";
import { ensureEnrolmentSecret, readPlatformSession } from "@/lib/platform-auth";
import { adminVerify2faAction } from "../auth-actions";
import { AdminAuthShell } from "../auth-shell";

export const metadata = { title: "Control verification", robots: { index: false } };

async function Step() {
  const s = await readPlatformSession();
  if (!s) redirect("/admin/login");
  if (!s.session.mfaPending) redirect("/admin");
  const enrolling = !s.admin.totpEnabled;
  const secret = enrolling ? await ensureEnrolmentSecret(s.admin) : null;
  const qr = secret ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(totpUri(secret, `Control:${s.admin.email}`), { type: "svg", margin: 1 })).toString("base64")}` : null;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{enrolling ? "Set up two-factor" : "Two-factor check"}</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{enrolling ? "Two-factor authentication is required for Control. Scan this with Google Authenticator, 1Password or Authy, then enter the code." : `Enter the code from your authenticator, ${s.admin.name.split(" ")[0]}.`}</p>
      {qr && (
        <div className="mb-6 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL QR */}
          <img src={qr} alt="Authenticator QR code" className="h-44 w-44 rounded-2xl p-2 shadow-glow" style={{ background: "#fff" }} />
          <code className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] tracking-wider text-muted">{secret}</code>
        </div>
      )}
      <ActionForm action={adminVerify2faAction} className="space-y-4">
        <Field label="6-digit code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required className="h-14 text-center font-mono text-2xl tracking-[0.6em]" /></Field>
        <Submit size="lg" className="w-full">{enrolling ? "Turn on and continue" : "Verify"}</Submit>
      </ActionForm>
    </>
  );
}

export default function AdminTwoFactorPage() {
  return <AdminAuthShell><Suspense fallback={<div className="skeleton h-64" />}><Step /></Suspense></AdminAuthShell>;
}
