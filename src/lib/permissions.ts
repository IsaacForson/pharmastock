import type { Role } from "@/db/schema";

export const PERMISSIONS = [
  "pos.sell", "pos.discount", "pos.void", "pos.return", "pos.credit", "pos.price_override",
  "sell.pharmacy", // supply P / POM / controlled items (pharmacist supervision)
  "customers.read", "customers.write",
  "prescriptions.read", "prescriptions.write",
  "controlled.register", "controlled.destroy",
  "products.write", "prices.write",
  "stock.view", "stock.receive", "stock.adjust", "stock.take", "stock.transfer",
  "purchasing.manage", "suppliers.manage", "supplier.payments",
  "cashup", "expenses.manage", "deliveries.manage", "claims.manage",
  "reports.view", "reports.margin", "messaging.send", "ai.ask",
  "settings.manage", "users.manage", "export", "audit.view", "api.manage",
  "subscription.manage", "admin.console",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS];
const counter: Permission[] = ["pos.sell", "pos.discount", "customers.read", "customers.write", "stock.view", "deliveries.manage"];
const stockWork: Permission[] = ["stock.view", "stock.receive", "stock.take", "stock.transfer"];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: all,
  // Pharmacy manager: runs the shop. Plan & payment stay with the owner; supplying P/POM/CD stays with pharmacists.
  admin: all.filter((p) => !(["subscription.manage", "sell.pharmacy", "controlled.register", "controlled.destroy"] as Permission[]).includes(p)),
  pharmacist: [
    ...counter, ...stockWork, "sell.pharmacy", "pos.void", "pos.return", "pos.credit", "prescriptions.read", "prescriptions.write",
    "controlled.register", "controlled.destroy", "stock.adjust", "products.write", "purchasing.manage", "cashup", "claims.manage",
    "reports.view", "messaging.send", "ai.ask",
  ],
  cashier: [...counter, "pos.credit", "cashup", "expenses.manage", "prescriptions.read"],
  stock_clerk: [...stockWork, "purchasing.manage", "suppliers.manage", "products.write"],
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner", admin: "Manager", pharmacist: "Pharmacist", cashier: "Cashier", stock_clerk: "Stock clerk",
};
