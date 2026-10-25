import { BarChart3, Boxes, CalendarX, Landmark, Percent, ShieldCheck, ShoppingCart, UserCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";

/** Icon + tone per report group (presentation only). */
export const GROUP_META: Record<string, { icon: ReactNode; tone: "purple" | "teal" | "blue" | "green" | "yellow" | "red" }> = {
  Sales: { icon: <Wallet />, tone: "green" },
  Margin: { icon: <Percent />, tone: "purple" },
  Stock: { icon: <Boxes />, tone: "teal" },
  Expiry: { icon: <CalendarX />, tone: "red" },
  Purchasing: { icon: <ShoppingCart />, tone: "blue" },
  Finance: { icon: <Landmark />, tone: "yellow" },
  Staff: { icon: <UserCheck />, tone: "blue" },
  Compliance: { icon: <ShieldCheck />, tone: "purple" },
};
export const groupMeta = (g: string) => GROUP_META[g] ?? { icon: <BarChart3 />, tone: "purple" as const };
