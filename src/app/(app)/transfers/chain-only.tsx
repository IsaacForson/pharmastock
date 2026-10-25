import { ArrowLeftRight } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";

export function ChainOnly() {
  return (
    <>
      <PageHeader title="Transfers" eyebrow="Stock" icon={<ArrowLeftRight />} />
      <EmptyState icon={<ArrowLeftRight />} title="Branch transfers are part of the Chain plan">Move stock between branches with batch and expiry kept. Ask the owner to upgrade in Settings.</EmptyState>
    </>
  );
}
