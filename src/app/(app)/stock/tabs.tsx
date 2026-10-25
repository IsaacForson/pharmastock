import { Segmented } from "@/components/ui";

export function StockTabs({ current }: { current: "products" | "batches" | "movements" | "take" }) {
  return <Segmented current={current} tabs={[
    { key: "products", label: "By product", href: "/stock" },
    { key: "batches", label: "Batches", href: "/stock/batches" },
    { key: "movements", label: "Movements", href: "/stock/movements" },
    { key: "take", label: "Stock takes", href: "/stock/take" },
  ]} />;
}
