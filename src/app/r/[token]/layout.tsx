import { Suspense } from "react";

// Per-request data behind a signed receipt link.
export const instant = false;

export default function PublicReceiptLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="page-bg min-h-screen" aria-busy="true" />}>{children}</Suspense>;
}
