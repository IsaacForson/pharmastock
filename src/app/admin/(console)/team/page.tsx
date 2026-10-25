import { desc } from "drizzle-orm";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { ActionButton, ActionForm, Submit } from "@/components/form";
import { Avatar, Badge, Field, Input, PageHeader, Panel, Select, Table, Td } from "@/components/ui";
import { adminDb } from "@/db";
import { platformAdmins } from "@/db/schema";
import { dateTime } from "@/lib/format";
import { PLATFORM_ROLE_LABELS, requireAdmin } from "@/lib/platform-auth";
import { createAdminAction, updateAdminAction } from "../actions";

export const metadata = { title: "Team" };

const ROLE_HELP = {
  super_admin: "Everything, including deleting pharmacies, suspensions and managing the team.",
  finance: "Revenue, subscriptions, plan changes and trial extensions.",
  support: "Pharmacy details, read-only support view, recall notices, background jobs.",
};

export default async function TeamPage() {
  const ctx = await requireAdmin("team.manage");
  const admins = await adminDb().select().from(platformAdmins).orderBy(desc(platformAdmins.createdAt));
  return (
    <>
      <PageHeader eyebrow="Access" icon={<Users />} title="PharmaStock team" subtitle="Who can use Control. Everyone must use two-factor authentication; every action is logged." />
      <section className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <Panel title="Team members" icon={<ShieldCheck />}>
            <Table head={["Member", "Role", "2FA", "Last sign-in", "Actions"]}>
              {admins.map((a) => (
                <tr key={a.id} className={a.active ? undefined : "opacity-50"}>
                  <Td><span className="flex items-center gap-3"><Avatar name={a.name} size="sm" /><span><span className="block font-medium">{a.name}{a.id === ctx.admin.id && <span className="text-subtle"> (you)</span>}</span><span className="block text-xs text-subtle">{a.email}</span></span></span></Td>
                  <Td>
                    {a.id === ctx.admin.id ? <Badge tone="purple">{PLATFORM_ROLE_LABELS[a.role]}</Badge> : (
                      <ActionForm action={updateAdminAction} className="flex items-center gap-1.5 space-y-0">
                        <input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="role" />
                        <Select name="role" defaultValue={a.role} className="h-8 w-36 text-xs">{Object.entries(PLATFORM_ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                        <Submit size="sm" variant="secondary">Set</Submit>
                      </ActionForm>
                    )}
                  </Td>
                  <Td>{a.totpEnabled ? <Badge tone="green">on</Badge> : <Badge tone="yellow">enrol at sign-in</Badge>}</Td>
                  <Td className="text-muted">{a.lastLoginAt ? dateTime(a.lastLoginAt, "UTC") : "never"}</Td>
                  <Td className="space-x-1">
                    {a.id !== ctx.admin.id && <>
                      <ActionButton action={updateAdminAction} fields={{ id: a.id, op: a.active ? "deactivate" : "activate" }} confirm={a.active ? `Remove ${a.name}'s access?` : undefined}>{a.active ? "Deactivate" : "Activate"}</ActionButton>
                      <ActionButton action={updateAdminAction} fields={{ id: a.id, op: "reset_2fa" }} confirm="Reset their 2FA? They'll enrol again.">Reset 2FA</ActionButton>
                      <ActionButton action={updateAdminAction} fields={{ id: a.id, op: "reset_password" }} confirm="Generate a new temporary password?">New password</ActionButton>
                    </>}
                  </Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </div>
        <div className="space-y-4 xl:col-span-4">
          <Panel title="Add a team member" icon={<UserPlus />} glow>
            <ActionForm action={createAdminAction} resetOnSuccess className="space-y-3">
              <Field label="Name"><Input name="name" required /></Field>
              <Field label="Work email"><Input name="email" type="email" required /></Field>
              <Field label="Role"><Select name="role" defaultValue="support">{Object.entries(PLATFORM_ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Submit className="w-full">Create and show temporary password</Submit>
            </ActionForm>
          </Panel>
          <Panel title="Roles">
            <ul className="space-y-3 text-sm">{Object.entries(ROLE_HELP).map(([k, v]) => <li key={k}><div className="font-medium">{PLATFORM_ROLE_LABELS[k as keyof typeof ROLE_HELP]}</div><div className="text-muted">{v}</div></li>)}</ul>
          </Panel>
        </div>
      </section>
    </>
  );
}
