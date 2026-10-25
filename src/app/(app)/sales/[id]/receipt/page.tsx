import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/ui";
import { audit, requireCtx, tx } from "@/lib/auth";
import { loadReceipt } from "../../data";
import { ThermalPrintButton } from "../../escpos-button";
import { ReceiptView } from "../../receipt-view";

export const metadata = { title: "Receipt" };

export default async function ReceiptPage({ params, searchParams }: PageProps<"/sales/[id]/receipt">) {
  const { id } = await params;
  const a4 = (await searchParams).format === "a4";
  const ctx = await requireCtx("pos.sell");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await tx(ctx, async (t) => {
    const d = await loadReceipt(t, ctx.tenant, id);
    if (d) await audit(t, ctx, "print", "sale", id, { details: { format: a4 ? "a4" : "thermal" } });
    return d;
  });
  if (!data) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      {!a4 && <style>{"@media print { @page { size: 80mm auto; margin: 0 } }"}</style>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <LinkButton variant="ghost" href={`/sales/${id}`}><ArrowLeft className="h-4 w-4" aria-hidden /> Back</LinkButton>
        <div className="flex gap-2">
          <LinkButton variant="secondary" href={a4 ? `/sales/${id}/receipt` : `/sales/${id}/receipt?format=a4`}>{a4 ? "80mm receipt" : "A4 invoice"}</LinkButton>
          <ThermalPrintButton data={data} />
        </div>
      </div>
      <div className={a4 ? "glass print:border-0" : "rounded-2xl border border-line print:border-0"}><ReceiptView d={data} format={a4 ? "a4" : "thermal"} /></div>
    </div>
  );
}
