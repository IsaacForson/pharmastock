import { Suspense } from "react";

// Per-request data behind a supplier link.
export const instant = false;

export const metadata = { title: "Purchase order", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function SupplierPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="backdrop-os min-h-screen text-fg">
      <main className="mx-auto max-w-4xl px-4 pb-12 pt-6 sm:pt-10 print:p-0">
        <Suspense fallback={<div className="space-y-4" aria-busy="true"><div className="skeleton h-40 rounded-[1.25rem]" /><div className="skeleton h-72 rounded-[1.25rem]" /></div>}>
          {children}
        </Suspense>
      </main>
    </div>
  );
}
