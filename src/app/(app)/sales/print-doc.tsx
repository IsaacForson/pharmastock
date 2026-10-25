import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { PrintButton } from "@/components/form";
import { LinkButton } from "@/components/ui";
import type { Tenant } from "@/db/schema";
import { LogoMark } from "../nav";

/** Print page wrapper: back link + print button (hidden on paper) and the pharmacy letterhead on an A4 sheet. */
export function PrintDoc({ tenant, title, back, children, actions }: { tenant: Tenant; title: string; back: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl animate-rise">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <LinkButton variant="ghost" href={back}><ArrowLeft className="h-4 w-4" aria-hidden /> Back</LinkButton>
        <div className="flex flex-wrap gap-2">{actions}<PrintButton /></div>
      </div>
      <article className="glass relative overflow-hidden p-6 sm:p-10 print:rounded-none print:border-0 print:p-0">
        <div className="absolute inset-x-0 top-0 h-1 bg-aurora print:hidden" aria-hidden />
        <header className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-line-strong pb-6">
          <div className="flex items-start gap-4">
            {tenant.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={tenant.logoUrl} alt="" className="h-14 w-14 rounded-xl object-contain" />
              : <LogoMark className="h-12 w-12 print:shadow-none" />}
            <div className="space-y-0.5">
              <div className="text-xl font-semibold tracking-tight text-fg">{tenant.name}</div>
              {tenant.letterhead && <div className="whitespace-pre-line text-xs text-muted">{tenant.letterhead}</div>}
              <div className="text-xs text-muted">{[tenant.address, tenant.phone, tenant.email].filter(Boolean).join(" · ")}</div>
              {(tenant.licenceNo || tenant.taxId) && (
                <div className="text-xs text-subtle">{[tenant.licenceNo && `Licence ${tenant.licenceNo}`, tenant.taxId && `TIN ${tenant.taxId}`].filter(Boolean).join(" · ")}</div>
              )}
            </div>
          </div>
          <div className="text-right text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">{title}</div>
        </header>
        {children}
      </article>
    </div>
  );
}
