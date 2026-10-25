import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { adminDb } from "@/db";
import { sales, tenants } from "@/db/schema";
import { loadReceipt } from "@/app/(app)/sales/data";
import { ReceiptView } from "@/app/(app)/sales/receipt-view";
import { verifyReceipt } from "../token";

export const metadata = { title: "Receipt", robots: { index: false, follow: false } };

/** Public receipt from a WhatsApp link. The signed token is the only key; the page shows what the paper receipt shows. */
export default async function PublicReceipt({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const saleId = verifyReceipt(token);
  if (!saleId) notFound();
  const data = await adminDb().transaction(async (t) => {
    const [s] = await t.select({ tenantId: sales.tenantId }).from(sales).where(eq(sales.id, saleId));
    if (!s) return null;
    const [tenant] = await t.select().from(tenants).where(eq(tenants.id, s.tenantId));
    return tenant && !tenant.suspendedAt ? loadReceipt(t, tenant, saleId) : null;
  });
  if (!data) notFound();
  return (
    <main className="backdrop-os min-h-screen px-4 py-10">
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-line shadow-panel">
        <ReceiptView d={{ ...data, link: null, customer: data.customer ? { ...data.customer, balanceMinor: 0, points: 0 } : null }} />
      </div>
    </main>
  );
}
