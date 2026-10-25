import { desc, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { ActionForm, Submit } from "@/components/form";
import { CircleUserRound, Fingerprint, Hash, LockKeyhole, Monitor, MonitorSmartphone, QrCode, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { Avatar, Badge, EmptyState, Field, IconTile, Input, ListRow, PageHeader, Panel } from "@/components/ui";
import { adminDb } from "@/db";
import { sessions } from "@/db/schema";
import { requireCtx } from "@/lib/auth";
import { totpUri } from "@/lib/crypto";
import { dateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { changePasswordAction, confirmTotpAction, disableTotpAction, setMyPinAction, signOutOthersAction, startTotpAction, updateMyProfileAction } from "./actions";

export const metadata = { title: "My account" };

const device = (ua: string | null) => !ua ? "Unknown device" : `${/Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Other"} · ${/Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser"}`;

export default async function AccountPage() {
  const ctx = await requireCtx();
  const u = ctx.user, tz = ctx.tenant.timezone;
  const mySessions = await adminDb().select().from(sessions).where(eq(sessions.userId, u.id)).orderBy(desc(sessions.lastSeenAt));
  const pendingSecret = !u.totpEnabled && u.totpSecret ? u.totpSecret : null;
  const qr = pendingSecret ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(totpUri(pendingSecret, u.email ?? u.phone ?? u.name), { type: "svg", margin: 1 })).toString("base64")}` : null;
  const step = (n: number, title: string, body: React.ReactNode, done?: boolean) => (
    <li className="flex gap-3">
      <span className={done ? "grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand text-xs font-semibold text-on-accent" : "grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line-strong bg-surface-2 text-xs font-semibold text-muted"}>{n}</span>
      <div className="min-w-0 flex-1 pt-0.5"><div className="text-sm font-medium text-fg">{title}</div><div className="mt-1 text-sm text-muted">{body}</div></div>
    </li>
  );
  return (
    <>
      <PageHeader icon={<CircleUserRound />} eyebrow="Personal" title="My account" subtitle={`${ROLE_LABELS[u.role]} · ${ctx.tenant.name}`} />

      <section className="sheet relative mb-6 overflow-hidden p-6">
        <div className="relative flex flex-wrap items-center gap-4">
          <Avatar name={u.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-fg">{u.name}</h2>
            <p className="truncate text-sm text-muted">{u.email ?? u.phone}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="purple">{ROLE_LABELS[u.role]}</Badge>
            <Badge tone={u.totpEnabled ? "green" : "yellow"}>{u.totpEnabled ? "2FA on" : "2FA off"}</Badge>
            <Badge tone={u.pinHash ? "teal" : "gray"}>{u.pinHash ? "PIN set" : "No PIN"}</Badge>
            {u.regNo && <Badge tone="green">Reg. {u.regNo}</Badge>}
            <Badge tone="teal">{mySessions.length} device{mySessions.length === 1 ? "" : "s"}</Badge>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Profile" eyebrow="Your details" icon={<UserRound />}>
          <ActionForm action={updateMyProfileAction} className="space-y-4">
            <Field label="Name"><Input name="name" defaultValue={u.name} required /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email"><Input name="email" type="email" defaultValue={u.email ?? ""} /></Field>
              <Field label="Phone"><Input name="phone" type="tel" defaultValue={u.phone ?? ""} /></Field>
            </div>
            <div className="flex justify-end"><Submit>Save profile</Submit></div>
          </ActionForm>
        </Panel>

        <Panel title="Password" eyebrow="Sign-in" icon={<LockKeyhole />}>
          <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-4">
            <Field label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password" hint="At least 8 characters"><Input name="next" type="password" autoComplete="new-password" minLength={8} required /></Field>
              <Field label="Confirm new password"><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
            </div>
            <div className="flex justify-end"><Submit variant="secondary">Change password</Submit></div>
          </ActionForm>
        </Panel>

        <Panel title="Counter PIN" eyebrow="Shared till" icon={<Hash />}>
          <ActionForm action={setMyPinAction} resetOnSuccess className="space-y-4">
            <p className="text-sm text-muted">A 4–6 digit PIN to switch to your account quickly on a shared till{u.role === "pharmacist" ? " and to approve P, POM and controlled-drug sales" : ""}. Don&apos;t share it.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={u.pinHash ? "New PIN" : "PIN"}><Input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="new-password" required /></Field>
              <Field label="Your password" hint="To confirm it's you"><Input name="password" type="password" autoComplete="current-password" required /></Field>
            </div>
            <div className="flex justify-end"><Submit variant="secondary">{u.pinHash ? "Change PIN" : "Set PIN"}</Submit></div>
          </ActionForm>
        </Panel>

        <Panel title="Two-factor authentication" eyebrow="Extra protection" icon={<Fingerprint />} glow={!!pendingSecret}
          actions={u.totpEnabled ? <Badge tone="green" pulse>On</Badge> : <Badge>Off</Badge>}>
          {u.totpEnabled ? (
            <ActionForm action={disableTotpAction} className="space-y-4">
              <div className="flex items-center gap-3 rounded border border-ok/25 bg-ok/10 px-4 py-3 text-sm text-fg">
                <ShieldCheck className="h-5 w-5 shrink-0 text-ok" aria-hidden />You enter a code from your authenticator app when signing in.
              </div>
              <Field label="Current 6-digit code to turn off"><Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="max-w-xs font-mono tracking-[0.4em]" /></Field>
              <Submit variant="danger">Turn off</Submit>
            </ActionForm>
          ) : pendingSecret ? (
            <ol className="space-y-5">
              {step(1, "Scan the code", "Use Google Authenticator, Microsoft Authenticator or Authy.", true)}
              <li className="flex justify-center">
                <div className="mark-brand relative rounded-md bg-surface-2 p-3">
                  {qr && <img src={qr} alt="QR code for your authenticator app" className="relative h-44 w-44 rounded-md bg-solid p-2" />}
                </div>
              </li>
              {step(2, "Can't scan?", <>Enter this key: <code className="select-all break-all rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-accent-2">{pendingSecret}</code></>)}
              <li>
                {step(3, "Confirm the 6-digit code", "Type the code your app shows right now.")}
                <ActionForm action={confirmTotpAction} className="mt-3 space-y-3 pl-10">
                  <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus aria-label="6-digit code" placeholder="123456" className="h-12 max-w-xs text-center font-mono text-lg tracking-[0.4em]" />
                  <Submit>Turn on two-factor</Submit>
                </ActionForm>
              </li>
            </ol>
          ) : (
            <ActionForm action={startTotpAction} className="space-y-4">
              <div className="flex items-start gap-3 rounded border border-line bg-surface px-4 py-3">
                <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
                <p className="text-sm text-muted">Protect your pharmacy&apos;s records with a code from your phone in addition to your password. Takes about a minute.</p>
              </div>
              <Submit>Set up two-factor</Submit>
            </ActionForm>
          )}
        </Panel>

        <Panel title="Signed-in devices" eyebrow={`${mySessions.length} active`} icon={<MonitorSmartphone />}
          actions={mySessions.length > 1 && <ActionForm action={signOutOthersAction}><Submit variant="secondary" size="sm">Sign out others</Submit></ActionForm>}>
          {mySessions.length === 0 ? <EmptyState compact icon={<MonitorSmartphone />} title="No active sessions" /> : (
            <ul className="-mx-3 space-y-1">
              {mySessions.map((s) => {
                const mobile = /Android|iPhone|iPad/.test(s.userAgent ?? "");
                return (
                  <li key={s.id}>
                    <ListRow
                      leading={<IconTile tone={s.id === ctx.sessionId ? "teal" : "gray"}>{mobile ? <Smartphone /> : <Monitor />}</IconTile>}
                      title={device(s.userAgent)}
                      meta={<span className="font-mono">{s.ip ?? "—"}</span>}
                      trailing={<div className="text-right">
                        {s.id === ctx.sessionId ? <Badge tone="teal" pulse>This device</Badge> : null}
                        <div className="mt-1 text-xs text-subtle tabular-nums">{dateTime(s.lastSeenAt, tz)}</div>
                      </div>} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
