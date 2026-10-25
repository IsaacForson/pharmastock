import type { Tone } from "@/components/ui";
import type { Role } from "@/db/schema";

export const ROLE_TONE: Record<Role, Tone> = { owner: "purple", admin: "purple", pharmacist: "green", cashier: "yellow", stock_clerk: "teal" };

/** One line per role for the staff screen, matching src/lib/permissions.ts. */
export const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including plan and payment.",
  admin: "Runs the pharmacy: staff, prices, stock, reports. Can't supply P/POM/controlled items or change the plan.",
  pharmacist: "Till plus supervising P/POM and controlled drugs, prescriptions, the register, stock and purchasing.",
  cashier: "Till, customers, credit, daily close and expenses.",
  stock_clerk: "Receiving, stock takes, transfers, suppliers and purchase orders. No till.",
};
