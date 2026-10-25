import { Check, Field, Input, Select } from "@/components/ui";
import type { User } from "@/db/schema";
import { ROLE_LABELS } from "@/lib/permissions";
import { ROLE_HELP } from "./roles";

export function StaffFields({ u, branches, canMakeOwner }: { u?: User; branches: { id: string; name: string }[]; canMakeOwner: boolean }) {
  const all = !u?.branchIds?.length;
  const roles = Object.entries(ROLE_LABELS).filter(([k]) => canMakeOwner || k !== "owner" || u?.role === "owner");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Full name"><Input name="name" defaultValue={u?.name} required /></Field>
        <Field label="Email" hint="Email or phone is their login"><Input name="email" type="email" defaultValue={u?.email ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" type="tel" defaultValue={u?.phone ?? ""} /></Field>
        <Field label="Role" hint={Object.entries(ROLE_HELP).filter(([k]) => k === (u?.role ?? "cashier")).map(([, v]) => v)[0]}>
          <Select name="role" defaultValue={u?.role ?? "cashier"}>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
        <Field label="Pharmacist registration no." hint="Required for pharmacists; printed on the register"><Input name="regNo" defaultValue={u?.regNo ?? ""} className="font-mono" /></Field>
        <Field label="Largest discount they can give (%)" hint="Per line at the till. 0 = no discounts.">
          <Input name="maxDiscount" inputMode="decimal" defaultValue={String((u?.maxDiscountBp ?? 1000) / 100)} className="tabular-nums" />
        </Field>
      </div>
      {branches.length > 1 && (
        <fieldset className="rounded-xl border border-line bg-surface px-4 py-3">
          <legend className="px-1 text-xs font-medium tracking-wide text-muted">Branch access</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Check name="allBranches" defaultChecked={all} label="All branches" />
            {branches.map((b) => (
              <Check key={b.id} name="branchIds" value={b.id} defaultChecked={!all && u?.branchIds?.includes(b.id)} label={b.name} />
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
