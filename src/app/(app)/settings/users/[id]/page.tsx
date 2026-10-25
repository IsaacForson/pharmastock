import { eq } from "drizzle-orm";
import { ArrowLeft, Hash, KeyRound, ShieldAlert, UserCog } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { Avatar, Badge, Dl, Input, LinkButton, Panel } from "@/components/ui";
import { users } from "@/db/schema";
import { requireCtx, tx } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/permissions";
import { SecretActionForm } from "../../secret-form";
import { resetStaffPasswordAction, setStaffActiveAction, setStaffPinAction, updateStaffAction } from "../actions";
import { ROLE_TONE } from "../roles";
import { StaffFields } from "../staff-fields";

export const metadata = { title: "Staff member" };
export default async function EditStaffPage({ params }: PageProps<"/settings/users/[id]">) {
  const { id } = await params;
  const ctx = await requireCtx("users.manage");
  const [u] = await tx(ctx, (t) => t.select().from(users).where(eq(users.id, id)));
  if (!u) notFound();
  const self = u.id === ctx.user.id;
  const tz = ctx.tenant.timezone;
  return (
    <>
      <div className="flex"><LinkButton href="/settings/users" variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" aria-hidden /> All staff</LinkButton></div>

      <section className="glass relative overflow-hidden p-6 animate-rise">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-aurora opacity-20 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-4">
          <Avatar name={u.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-fg">{u.name}</h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
              <Badge tone={u.active ? "green" : "gray"}>{u.active ? "Active" : "Deactivated"}</Badge>
              <Badge tone={u.totpEnabled ? "green" : "yellow"}>{u.totpEnabled ? "2FA on" : "2FA off"}</Badge>
              <Badge tone={u.pinHash ? "teal" : "gray"}>{u.pinHash ? "PIN set" : "No PIN"}</Badge>
              {self && <Badge tone="teal">You</Badge>}
            </div>
          </div>
        </div>
        <div className="relative mt-5 border-t border-line pt-5">
          <Dl cols={3} items={[["Login", u.email ?? u.phone], ["Last sign-in", dateTime(u.lastLoginAt, tz) || "Never"], ["Registration no.", u.regNo]]} />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel title="Profile & permissions" eyebrow="Edit" icon={<UserCog />}>
          <ActionForm action={updateStaffAction} className="space-y-5">
            <input type="hidden" name="id" value={u.id} />
            <StaffFields u={u} branches={ctx.branches} canMakeOwner={ctx.user.role === "owner"} />
            <div className="flex justify-end"><Submit>Save changes</Submit></div>
          </ActionForm>
        </Panel>

        <div className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          <Panel title="Password" eyebrow="Access" icon={<KeyRound />}>
            <SecretActionForm action={resetStaffPasswordAction}>
              <input type="hidden" name="id" value={u.id} />
              <p className="text-sm text-muted">Generates a new temporary password and signs them out of other devices.</p>
              <Submit variant="secondary" className="w-full">Reset password</Submit>
            </SecretActionForm>
          </Panel>
          <Panel title="Counter PIN" eyebrow="Shared till" icon={<Hash />}>
            <ActionForm action={setStaffPinAction} resetOnSuccess className="space-y-3">
              <input type="hidden" name="id" value={u.id} />
              <p className="text-sm text-muted">A 4–6 digit PIN to approve P/POM sales and switch user quickly at a shared till.{u.pinHash ? " Setting a new one replaces the old PIN." : ""}</p>
              <Input name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="new-password" placeholder="New PIN" aria-label="New PIN" />
              <div className="flex gap-2">
                <Submit variant="secondary" className="flex-1">{u.pinHash ? "Reset PIN" : "Set PIN"}</Submit>
                {u.pinHash && <button name="clear" value="1" className="h-10 rounded-xl border border-line px-3 text-sm text-muted hover:text-fg">Remove</button>}
              </div>
            </ActionForm>
          </Panel>
          {!self && (
            <Panel title={u.active ? "Deactivate account" : "Reactivate account"} eyebrow="Danger zone" icon={<ShieldAlert />}>
              <p className="mb-4 text-sm text-muted">{u.active ? "They are signed out everywhere. Their records and history stay." : "Restores sign-in with their existing password."}</p>
              {u.active
                ? <ActionButton action={setStaffActiveAction} fields={{ id: u.id, active: "0" }} variant="danger" confirm={`Deactivate ${u.name}? They will be signed out everywhere. Their records stay.`}>Deactivate</ActionButton>
                : <ActionButton action={setStaffActiveAction} fields={{ id: u.id, active: "1" }}>Reactivate</ActionButton>}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
