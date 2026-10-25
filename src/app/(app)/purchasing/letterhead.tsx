import type { ReactNode } from "react";
import type { Tenant } from "@/db/schema";

/** Pharmacy letterhead for printed purchasing documents (PO, GRN, statement, return note) and the supplier portal. */
export function Letterhead({ tenant, branch, title, number, children }: {
  tenant: Pick<Tenant, "name" | "logoUrl" | "address" | "phone" | "email" | "letterhead" | "licenceNo" | "taxId">;
  branch?: { name: string; address: string | null; phone: string | null } | null; title: string; number?: string; children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-5">
      <div className="flex min-w-0 items-start gap-3">
        {tenant.logoUrl
          ? <img src={tenant.logoUrl} alt="" className="h-14 w-14 rounded border border-line object-contain p-1" />
          : <span className="grid h-14 w-14 place-items-center rounded bg-brand text-xl font-semibold text-on-accent print:border print:border-line print:bg-none print:text-fg">{tenant.name[0]}</span>}
        <div className="min-w-0 text-sm">
          <div className="text-lg font-semibold tracking-tight text-fg">{tenant.name}</div>
          {branch && <div className="text-muted">{branch.name}</div>}
          <div className="text-muted">{branch?.address || tenant.address}</div>
          <div className="text-muted">{[branch?.phone || tenant.phone, tenant.email].filter(Boolean).join(" · ")}</div>
          {tenant.letterhead && <div className="whitespace-pre-line text-xs text-subtle">{tenant.letterhead}</div>}
          {(tenant.licenceNo || tenant.taxId) && <div className="text-xs text-subtle">{[tenant.licenceNo && `Licence ${tenant.licenceNo}`, tenant.taxId && `Tax ID ${tenant.taxId}`].filter(Boolean).join(" · ")}</div>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[11px] font-mono uppercase tracking-wider text-subtle">{title}</div>
        {number && <div className="mt-1 font-mono text-lg font-semibold text-fg">{number}</div>}
        {children && <div className="mt-1 space-y-0.5 text-xs text-muted">{children}</div>}
      </div>
    </header>
  );
}

/** Centered sheet: sheet on screen, plain paper when printed. */
export function Sheet({ children }: { children: ReactNode }) {
  return <article className="sheet mx-auto max-w-3xl space-y-6 p-6 sm:p-10 print:max-w-none print:border-0 print:bg-transparent print:p-0 print:shadow-none">{children}</article>;
}
