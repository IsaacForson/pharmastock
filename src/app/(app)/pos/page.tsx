import { eq } from "drizzle-orm";
import { ScanLine } from "lucide-react";
import { customers, prescriptionItems, prescriptions } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { audit, requireCtx, tx } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { hasFeature } from "@/lib/plans";
import { Till, type TillRx } from "./till";

export const metadata = { title: "Till" };

export default async function PosPage({ searchParams }: PageProps<"/pos">) {
  const ctx = await requireCtx("pos.sell");
  const sp = await searchParams;
  const rxId = typeof sp.rx === "string" && /^[0-9a-f-]{36}$/.test(sp.rx) ? sp.rx : null;
  let rx: TillRx | null = null;
  if (rxId && hasFeature(ctx.tenant, "prescriptions") && can(ctx.user.role, "prescriptions.read")) {
    rx = await tx(ctx, async (t) => {
      const [row] = await t.select({ rx: prescriptions, customer: customers.name }).from(prescriptions)
        .innerJoin(customers, eq(customers.id, prescriptions.customerId)).where(eq(prescriptions.id, rxId));
      if (!row) return null;
      const items = await t.select().from(prescriptionItems).where(eq(prescriptionItems.prescriptionId, rxId));
      await audit(t, ctx, "view", "prescription", rxId, { customerId: row.rx.customerId, details: { via: "till" } });
      return {
        id: row.rx.id, rxNo: row.rx.rxNo, status: row.rx.status, customerId: row.rx.customerId, customerName: row.customer, prescriber: row.rx.prescriberName,
        items: items.map((i) => ({ id: i.id, drugName: i.drugName, productId: i.productId, qtyPrescribed: i.qtyPrescribed, directions: i.directions })),
      };
    });
  }
  return (
    <div>
      <div className="print:hidden"><PageHeader title="Till" eyebrow="Point of sale" icon={<ScanLine />} subtitle={rx ? `Dispensing ${rx.rxNo} for ${rx.customerName}` : "Scan or search to sell. Works offline."} /></div>
      {rx && rx.status !== "active" ? (
        <p className="sheet p-6 text-sm text-warn">Prescription {rx.rxNo} is {rx.status} and can&apos;t be dispensed.</p>
      ) : (
        <Till branchId={ctx.branchId} userId={ctx.user.id} rx={rx} />
      )}
    </div>
  );
}
