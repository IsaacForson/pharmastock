import { sql } from "drizzle-orm";
import {
  boolean, check, customType, date, doublePrecision, index, integer, jsonb, pgEnum, pgSchema, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { decrypt, encrypt } from "@/lib/crypto";

/** Free text encrypted at the application layer (AES-256-GCM). Not searchable in SQL. */
const encrypted = customType<{ data: string; driverData: string }>({
  dataType: () => "text",
  toDriver: (v) => encrypt(v),
  fromDriver: (v) => decrypt(v),
});

const id = () => uuid("id").primaryKey().defaultRandom();
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" });
const branchId = () => uuid("branch_id").notNull().references(() => branches.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => integer(name).notNull().default(0); // minor units (pesewas, kobo, cents)

export type OpeningHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string] | null>;
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  "0": ["10:00", "16:00"], "1": ["08:00", "21:00"], "2": ["08:00", "21:00"], "3": ["08:00", "21:00"], "4": ["08:00", "21:00"], "5": ["08:00", "21:00"], "6": ["08:00", "21:00"],
};

// ---------- Enums ----------
export const roleEnum = pgEnum("role", ["owner", "admin", "pharmacist", "cashier", "stock_clerk"]);
export const platformRoleEnum = pgEnum("platform_role", ["super_admin", "support", "finance"]);
export const planEnum = pgEnum("plan", ["starter", "pro", "chain"]);
export const planStatusEnum = pgEnum("plan_status", ["trialing", "active", "past_due", "read_only", "cancelled"]);
/** OTC = over the counter, P = pharmacy-only (pharmacist present), POM = prescription-only, CD = controlled drug. */
export const scheduleEnum = pgEnum("drug_schedule", ["otc", "pharmacy", "pom", "controlled", "non_drug"]);
export const payMethodEnum = pgEnum("payment_method", ["cash", "mobile_money", "card", "bank", "insurance", "credit", "loyalty"]);
export const payStatusEnum = pgEnum("payment_status", ["pending", "succeeded", "failed", "refunded"]);
export const saleStatusEnum = pgEnum("sale_status", ["completed", "partially_returned", "returned", "voided"]);
export const poStatusEnum = pgEnum("po_status", ["draft", "sent", "confirmed", "partially_received", "received", "cancelled"]);
export const channelEnum = pgEnum("channel", ["whatsapp", "sms", "email"]);
export const msgStatusEnum = pgEnum("message_status", ["queued", "sent", "delivered", "read", "failed", "skipped"]);
export const stockMoveEnum = pgEnum("stock_movement_type", [
  "receive", "sale", "sale_return", "adjust", "transfer_out", "transfer_in", "expire", "supplier_return", "stocktake", "damage",
]);
export const alertKindEnum = pgEnum("alert_kind", ["expiry_90", "expiry_60", "expiry_30", "expired", "low_stock", "out_of_stock", "recall", "return_window", "stock_discrepancy", "refill_due", "sale_review"]);
export const alertStatusEnum = pgEnum("alert_status", ["open", "done", "dismissed"]);
export const claimStatusEnum = pgEnum("claim_status", ["draft", "submitted", "partially_paid", "paid", "rejected"]);
export const jobStatusEnum = pgEnum("job_status", ["pending", "running", "done", "failed", "cancelled"]);

// ---------- Tenancy ----------
export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  country: text("country").notNull().default("GH"),
  currency: text("currency").notNull().default("GHS"),
  timezone: text("timezone").notNull().default("Africa/Accra"),
  locale: text("locale").notNull().default("en"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  logoUrl: text("logo_url"),
  letterhead: text("letterhead"), // extra lines printed under the pharmacy name
  licenceNo: text("licence_no"), // premises licence from the pharmacy regulator
  superintendent: text("superintendent"), // superintendent pharmacist name, printed on registers
  superintendentRegNo: text("superintendent_reg_no"),
  taxId: text("tax_id"),
  /** Shelf prices include tax (normal for retail). Tax is then backed out of the line total. */
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  defaultTaxBp: integer("default_tax_bp").notNull().default(0), // basis points: 1500 = 15%
  /** Days before expiry when alerts fire, e.g. {90,60,30}. */
  expiryAlertDays: integer("expiry_alert_days").array().notNull().default(sql`'{90,60,30}'::int[]`),
  /** Days of cover the reorder suggestion targets (lead time + safety). */
  reorderCoverDays: integer("reorder_cover_days").notNull().default(21),
  ownerSummaryTime: text("owner_summary_time").notNull().default("21:30"), // HH:MM local, daily WhatsApp summary
  ownerSummaryTo: text("owner_summary_to"), // E.164; null = owner's phone
  loyaltyEnabled: boolean("loyalty_enabled").notNull().default(false),
  loyaltyEarnPerMajor: integer("loyalty_earn_per_major").notNull().default(1), // points per 1 major unit spent
  loyaltyPointValueMinor: integer("loyalty_point_value_minor").notNull().default(1), // what 1 point is worth at redemption
  deliveryFeeMinor: integer("delivery_fee_minor").notNull().default(0),
  receiptFooter: text("receipt_footer"),
  plan: planEnum("plan").notNull().default("pro"),
  planStatus: planStatusEnum("plan_status").notNull().default("trialing"),
  trialEndsAt: ts("trial_ends_at"),
  currentPeriodEnd: ts("current_period_end"),
  billingCycle: text("billing_cycle").notNull().default("monthly"), // monthly | annual
  billedBranches: integer("billed_branches").notNull().default(1), // chain plan: branches paid for (min 3)
  paystackCustomerCode: text("paystack_customer_code"),
  paystackSubscriptionCode: text("paystack_subscription_code"),
  suspendedAt: ts("suspended_at"), // platform suspension (abuse/fraud only): staff can't sign in; data kept
  suspendReason: text("suspend_reason"),
  adminNotes: text("admin_notes"), // internal notes by the PharmaStock team
  createdAt: createdAt(),
});

export const branches = pgTable("branches", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  licenceNo: text("licence_no"),
  isMain: boolean("is_main").notNull().default(false),
  active: boolean("active").notNull().default(true),
  openingHours: jsonb("opening_hours").$type<OpeningHours>().notNull().default(DEFAULT_OPENING_HOURS),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  email: text("email").unique(),
  phone: text("phone").unique(),
  passwordHash: text("password_hash"),
  pinHash: text("pin_hash"), // 4–6 digit counter PIN for quick user switching on a shared till
  role: roleEnum("role").notNull(),
  regNo: text("reg_no"), // pharmacist registration number
  branchIds: uuid("branch_ids").array(), // null = all branches
  totpSecret: encrypted("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  maxDiscountBp: integer("max_discount_bp").notNull().default(1000), // largest line discount this user may give
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
}, (t) => [index("users_tenant_idx").on(t.tenantId)]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  mfaPending: boolean("mfa_pending").notNull().default(false),
  impersonatedBy: uuid("impersonated_by"), // platform admin viewing this pharmacy (read-only support session)
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
}, (t) => [index("otp_phone_idx").on(t.phone)]);

// ---------- Catalogue ----------
export const categories = pgTable("categories", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
}, (t) => [uniqueIndex("categories_name_uq").on(t.tenantId, t.name)]);

export const suppliers = pgTable("suppliers", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  phone: text("phone"), // E.164; WhatsApp purchase orders go here
  email: text("email"),
  address: text("address"),
  licenceNo: text("licence_no"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(0),
  /** The supplier takes back stock that still has at least this many days to expiry. */
  returnMinDaysToExpiry: integer("return_min_days_to_expiry").notNull().default(90),
  /** …and only within this many days of delivery (0 = no limit). */
  returnWithinDaysOfDelivery: integer("return_within_days_of_delivery").notNull().default(0),
  leadTimeDays: integer("lead_time_days").notNull().default(3),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const products = pgTable("products", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(), // brand / trade name as on the shelf
  genericName: text("generic_name"), // INN, e.g. "Amoxicillin"
  strength: text("strength"), // "500 mg"
  form: text("form"), // tablet | capsule | syrup | injection | cream ...
  manufacturer: text("manufacturer"),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  schedule: scheduleEnum("schedule").notNull().default("otc"),
  baseUnit: text("base_unit").notNull().default("unit"), // smallest unit sold: tablet, bottle, tube ...
  taxBp: integer("tax_bp"), // null = tenant default; 0 for zero-rated medicines
  reorderLevel: integer("reorder_level").notNull().default(0), // base units; 0 = use sales velocity only
  reorderQty: integer("reorder_qty").notNull().default(0), // base units; 0 = suggested from velocity
  preferredSupplierId: uuid("preferred_supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  shelf: text("shelf"), // location, e.g. "A3"
  favorite: boolean("favorite").notNull().default(false), // quick key on the till
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("products_name_idx").on(t.tenantId, t.name), index("products_generic_idx").on(t.tenantId, t.genericName)]);

/** Pack sizes a product is bought and sold in. factor = base units per pack (tablet = 1, strip = 10, box = 100). */
export const productUnits = pgTable("product_units", {
  id: id(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  factor: integer("factor").notNull().default(1),
  sellPriceMinor: money("sell_price_minor"),
  sellable: boolean("sellable").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false), // what a scan/search adds by default
}, (t) => [index("product_units_product_idx").on(t.productId), check("product_units_factor_positive", sql`${t.factor} >= 1`)]);

export const barcodes = pgTable("barcodes", {
  id: id(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id").notNull().references(() => productUnits.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("barcodes_code_uq").on(t.tenantId, t.code)]);

/** Latest cost per supplier, from price-list imports and goods receipts. */
export const supplierPrices = pgTable("supplier_prices", {
  tenantId: tenantId(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id").notNull().references(() => productUnits.id, { onDelete: "cascade" }),
  costMinor: money("cost_minor"), // per unitId pack
  supplierCode: text("supplier_code"),
  source: text("source").notNull().default("manual"), // manual | import | receipt | portal
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.supplierId, t.productId, t.unitId] })]);

/** Selling price history, for price-change impact analysis. */
export const priceChanges = pgTable("price_changes", {
  id: id(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id").notNull().references(() => productUnits.id, { onDelete: "cascade" }),
  oldPriceMinor: integer("old_price_minor").notNull(),
  newPriceMinor: integer("new_price_minor").notNull(),
  changedBy: uuid("changed_by"),
  createdAt: createdAt(),
}, (t) => [index("price_changes_product_idx").on(t.productId, t.createdAt)]);

// ---------- Stock ledger ----------
/**
 * One row per batch per branch. qtyOnHand is in base units and is a cached total of this batch's stock_movements:
 * every change writes a movement in the same transaction (see @/lib/stock). It can never go negative.
 */
export const stockBatches = pgTable("stock_batches", {
  id: id(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  branchId: branchId(),
  batchNo: text("batch_no").notNull().default(""),
  mfgDate: date("mfg_date"),
  expiry: date("expiry"), // null = does not expire (non-drug items)
  qtyOnHand: integer("qty_on_hand").notNull().default(0),
  /** Cost per base unit in minor units; fractional because a 1000-tablet tin can cost less than 1 minor unit per tablet. */
  unitCostMinor: doublePrecision("unit_cost_minor").notNull().default(0),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  receiptId: uuid("receipt_id"),
  receivedAt: ts("received_at").notNull().defaultNow(),
  quarantined: boolean("quarantined").notNull().default(false), // recalled or under investigation: not sellable
  quarantineReason: text("quarantine_reason"),
}, (t) => [
  index("batches_product_idx").on(t.productId, t.branchId, t.expiry),
  index("batches_expiry_idx").on(t.tenantId, t.expiry),
  check("stock_batches_qty_nonnegative", sql`${t.qtyOnHand} >= 0`),
]);

export const stockMovements = pgTable("stock_movements", {
  id: id(),
  tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => stockBatches.id),
  branchId: branchId(),
  qty: integer("qty").notNull(), // base units: + in, - out
  type: stockMoveEnum("type").notNull(),
  unitCostMinor: doublePrecision("unit_cost_minor").notNull().default(0),
  ref: text("ref"), // human document number: SL-…, GRN-…, TRF-…, RTN-…, STK-…
  refId: uuid("ref_id"),
  reason: text("reason"),
  userId: uuid("user_id"),
  createdAt: createdAt(),
}, (t) => [index("movements_product_idx").on(t.productId, t.branchId, t.createdAt), index("movements_tenant_idx").on(t.tenantId, t.type, t.createdAt)]);

// ---------- Purchasing ----------
export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  poNo: text("po_no").notNull(),
  status: poStatusEnum("status").notNull().default("draft"),
  expectedAt: date("expected_at"),
  notes: text("notes"),
  totalMinor: money("total_minor"),
  sentAt: ts("sent_at"),
  sentVia: text("sent_via"), // whatsapp | email | portal | print
  confirmedAt: ts("confirmed_at"), // supplier confirmed through the portal link
  supplierNote: text("supplier_note"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("po_no_uq").on(t.tenantId, t.poNo)]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: id(),
  tenantId: tenantId(),
  poId: uuid("po_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  unitId: uuid("unit_id").notNull().references(() => productUnits.id),
  qty: integer("qty").notNull(), // in unitId packs
  unitCostMinor: money("unit_cost_minor"),
  supplierQty: integer("supplier_qty"), // what the supplier confirmed it can supply (portal)
  supplierCostMinor: integer("supplier_cost_minor"),
  receivedBaseQty: integer("received_base_qty").notNull().default(0),
});

/** Goods received note: what physically arrived, with batch and expiry captured per line. */
export const goodsReceipts = pgTable("goods_receipts", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  poId: uuid("po_id").references(() => purchaseOrders.id),
  grnNo: text("grn_no").notNull(),
  supplierInvoiceNo: text("supplier_invoice_no"),
  totalMinor: money("total_minor"),
  paidMinor: money("paid_minor"),
  dueAt: date("due_at"),
  notes: text("notes"),
  receivedBy: uuid("received_by"),
  receivedAt: ts("received_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("grn_no_uq").on(t.tenantId, t.grnNo)]);

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: id(),
  tenantId: tenantId(),
  receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  unitId: uuid("unit_id").notNull().references(() => productUnits.id),
  qty: integer("qty").notNull(), // packs
  freeQty: integer("free_qty").notNull().default(0), // bonus packs from the supplier
  unitCostMinor: money("unit_cost_minor"), // per pack
  batchNo: text("batch_no").notNull().default(""),
  mfgDate: date("mfg_date"),
  expiry: date("expiry"),
  batchId: uuid("batch_id").references(() => stockBatches.id),
});

/** Stock sent back to a supplier (near-expiry, damaged, recalled) and the credit note that settles it. */
export const supplierReturns = pgTable("supplier_returns", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  returnNo: text("return_no").notNull(),
  status: text("status").notNull().default("sent"), // sent | credited | partially_credited | rejected
  reason: text("reason").notNull(), // near_expiry | expired | damaged | recall | wrong_item | other
  valueMinor: money("value_minor"), // at cost
  creditNoteNo: text("credit_note_no"),
  creditedMinor: money("credited_minor"),
  creditedAt: ts("credited_at"),
  notes: text("notes"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("supplier_return_no_uq").on(t.tenantId, t.returnNo)]);

export const supplierReturnLines = pgTable("supplier_return_lines", {
  id: id(),
  tenantId: tenantId(),
  returnId: uuid("return_id").notNull().references(() => supplierReturns.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  batchId: uuid("batch_id").notNull().references(() => stockBatches.id),
  qty: integer("qty").notNull(), // base units
  unitCostMinor: doublePrecision("unit_cost_minor").notNull().default(0),
});

/** Supplier payments against goods receipts (accounts payable). */
export const supplierPayments = pgTable("supplier_payments", {
  id: id(),
  tenantId: tenantId(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  receiptId: uuid("receipt_id").references(() => goodsReceipts.id),
  amountMinor: integer("amount_minor").notNull(),
  method: payMethodEnum("method").notNull().default("bank"),
  reference: text("reference"),
  paidAt: date("paid_at").notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

// ---------- Branch transfers & stock takes ----------
export const transfers = pgTable("transfers", {
  id: id(),
  tenantId: tenantId(),
  transferNo: text("transfer_no").notNull(),
  fromBranchId: uuid("from_branch_id").notNull().references(() => branches.id),
  toBranchId: uuid("to_branch_id").notNull().references(() => branches.id),
  status: text("status").notNull().default("in_transit"), // in_transit | received | cancelled
  notes: text("notes"),
  sentBy: uuid("sent_by"),
  sentAt: ts("sent_at").notNull().defaultNow(),
  receivedBy: uuid("received_by"),
  receivedAt: ts("received_at"),
}, (t) => [uniqueIndex("transfer_no_uq").on(t.tenantId, t.transferNo)]);

export const transferLines = pgTable("transfer_lines", {
  id: id(),
  tenantId: tenantId(),
  transferId: uuid("transfer_id").notNull().references(() => transfers.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  fromBatchId: uuid("from_batch_id").notNull().references(() => stockBatches.id),
  toBatchId: uuid("to_batch_id").references(() => stockBatches.id),
  qty: integer("qty").notNull(), // base units
  receivedQty: integer("received_qty"),
});

export const stockTakes = pgTable("stock_takes", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  takeNo: text("take_no").notNull(),
  scope: text("scope").notNull().default("full"), // full | partial (only counted lines are adjusted)
  status: text("status").notNull().default("open"), // open | completed | cancelled
  notes: text("notes"),
  startedBy: uuid("started_by"),
  startedAt: ts("started_at").notNull().defaultNow(),
  completedBy: uuid("completed_by"),
  completedAt: ts("completed_at"),
}, (t) => [uniqueIndex("stock_take_no_uq").on(t.tenantId, t.takeNo)]);

export const stockTakeLines = pgTable("stock_take_lines", {
  id: id(),
  tenantId: tenantId(),
  takeId: uuid("take_id").notNull().references(() => stockTakes.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  batchId: uuid("batch_id").references(() => stockBatches.id), // null = found stock with no known batch
  batchNo: text("batch_no"),
  expiry: date("expiry"),
  expectedQty: integer("expected_qty").notNull().default(0), // snapshot when first counted
  countedQty: integer("counted_qty").notNull().default(0),
  countedBy: uuid("counted_by"),
  countedAt: ts("counted_at").notNull().defaultNow(),
}, (t) => [index("stock_take_lines_take_idx").on(t.takeId)]);

// ---------- Customers ----------
export const customers = pgTable("customers", {
  id: id(),
  tenantId: tenantId(),
  customerNo: text("customer_no").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  dob: date("dob"),
  sex: text("sex"),
  address: text("address"),
  allergies: encrypted("allergies"),
  notes: encrypted("notes"),
  creditLimitMinor: money("credit_limit_minor"), // 0 = no credit
  balanceMinor: money("balance_minor"), // amount owed to the pharmacy (credit sales minus repayments)
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  payerId: uuid("payer_id"), // default insurer / HMO
  memberNo: text("member_no"),
  /** Consent for reminders and receipts by WhatsApp/SMS. Opt-out always wins. */
  messagingConsent: boolean("messaging_consent").notNull().default(false),
  consentRecordedAt: ts("consent_recorded_at"),
  consentMethod: text("consent_method"), // verbal | whatsapp | form
  optedOutAt: ts("opted_out_at"),
  preferredChannel: channelEnum("preferred_channel").notNull().default("whatsapp"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("customers_no_uq").on(t.tenantId, t.customerNo),
  index("customers_phone_idx").on(t.tenantId, t.phone),
  index("customers_name_idx").on(t.tenantId, t.name),
]);

/** Customer account ledger: + credit sale (they owe more), - repayment or write-off. balanceMinor is its running sum. */
export const customerLedger = pgTable("customer_ledger", {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  amountMinor: integer("amount_minor").notNull(),
  kind: text("kind").notNull(), // credit_sale | repayment | write_off | return
  saleId: uuid("sale_id"),
  paymentId: uuid("payment_id"),
  note: text("note"),
  userId: uuid("user_id"),
  createdAt: createdAt(),
}, (t) => [index("customer_ledger_idx").on(t.customerId, t.createdAt)]);

export const loyaltyEntries = pgTable("loyalty_entries", {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  points: integer("points").notNull(), // + earned, - redeemed / reversed
  saleId: uuid("sale_id"),
  reason: text("reason").notNull(), // earn | redeem | return | adjust
  createdAt: createdAt(),
}, (t) => [index("loyalty_customer_idx").on(t.customerId, t.createdAt)]);

// ---------- Prescriptions ----------
export const prescriptions = pgTable("prescriptions", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  rxNo: text("rx_no").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  prescriberName: text("prescriber_name").notNull(),
  prescriberRegNo: text("prescriber_reg_no"),
  facility: text("facility"),
  issuedOn: date("issued_on").notNull(),
  diagnosis: encrypted("diagnosis"),
  notes: encrypted("notes"),
  documentKey: text("document_key"), // scanned/photographed prescription
  refillsAllowed: integer("refills_allowed").notNull().default(0),
  refillsUsed: integer("refills_used").notNull().default(0),
  refillIntervalDays: integer("refill_interval_days"), // chronic meds: reminder this many days after each fill
  nextRefillDue: date("next_refill_due"),
  status: text("status").notNull().default("active"), // active | completed | cancelled | expired
  verifiedBy: uuid("verified_by"), // pharmacist who checked it
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("rx_no_uq").on(t.tenantId, t.rxNo), index("rx_customer_idx").on(t.customerId), index("rx_refill_idx").on(t.tenantId, t.status, t.nextRefillDue)]);

export const prescriptionItems = pgTable("prescription_items", {
  id: id(),
  tenantId: tenantId(),
  prescriptionId: uuid("prescription_id").notNull().references(() => prescriptions.id, { onDelete: "cascade" }),
  productId: uuid("product_id").references(() => products.id),
  drugName: text("drug_name").notNull(), // as written by the prescriber
  dose: text("dose"),
  frequency: text("frequency"),
  duration: text("duration"),
  qtyPrescribed: integer("qty_prescribed").notNull().default(0), // base units per fill
  qtyDispensed: integer("qty_dispensed").notNull().default(0), // across all fills
  directions: text("directions"), // label text
});

// ---------- Sales ----------
export const payers = pgTable("payers", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(), // insurer / HMO / corporate account
  kind: text("kind").notNull().default("insurer"), // insurer | hmo | corporate | nhis
  code: text("code"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  coverageBp: integer("coverage_bp").notNull().default(10000), // share the payer covers by default
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const sales = pgTable("sales", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  saleNo: text("sale_no").notNull(),
  status: saleStatusEnum("status").notNull().default("completed"),
  customerId: uuid("customer_id").references(() => customers.id),
  prescriptionId: uuid("prescription_id").references(() => prescriptions.id),
  payerId: uuid("payer_id").references(() => payers.id),
  memberNo: text("member_no"),
  subtotalMinor: money("subtotal_minor"), // sum of line totals before sale-level discount
  discountMinor: money("discount_minor"), // line + sale discounts
  taxMinor: money("tax_minor"),
  totalMinor: money("total_minor"),
  payerPortionMinor: money("payer_portion_minor"),
  paidMinor: money("paid_minor"), // customer payments, net of refunds
  creditMinor: money("credit_minor"), // put on the customer's account
  changeMinor: money("change_minor"),
  costMinor: money("cost_minor"), // cost of goods sold (FEFO batch cost)
  loyaltyEarned: integer("loyalty_earned").notNull().default(0),
  loyaltyRedeemed: integer("loyalty_redeemed").notNull().default(0),
  /** Units sold offline that the books did not have (stock was already short when the sale synced). */
  shortBaseQty: integer("short_base_qty").notNull().default(0),
  offline: boolean("offline").notNull().default(false),
  clientId: text("client_id"), // idempotency key from the till / offline outbox (unique per tenant)
  cashierId: uuid("cashier_id"),
  pharmacistId: uuid("pharmacist_id"), // supervising pharmacist for P / POM / CD items
  voidReason: text("void_reason"),
  voidedBy: uuid("voided_by"),
  soldAt: ts("sold_at").notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("sale_no_uq").on(t.tenantId, t.saleNo),
  uniqueIndex("sales_client_uq").on(t.tenantId, t.clientId),
  index("sales_day_idx").on(t.tenantId, t.branchId, t.soldAt),
  index("sales_customer_idx").on(t.customerId),
]);

export type BatchAllocation = { batchId: string; qty: number; unitCostMinor: number };

export const saleLines = pgTable("sale_lines", {
  id: id(),
  tenantId: tenantId(),
  saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  unitId: uuid("unit_id").notNull().references(() => productUnits.id),
  description: text("description").notNull(),
  qty: integer("qty").notNull(), // packs of unitId
  baseQty: integer("base_qty").notNull(),
  unitPriceMinor: money("unit_price_minor"),
  discountMinor: money("discount_minor"),
  taxBp: integer("tax_bp").notNull().default(0),
  taxMinor: money("tax_minor"),
  totalMinor: money("total_minor"), // after discount, as charged
  costMinor: money("cost_minor"),
  allocations: jsonb("allocations").$type<BatchAllocation[]>().notNull().default([]),
  shortBaseQty: integer("short_base_qty").notNull().default(0),
  returnedBaseQty: integer("returned_base_qty").notNull().default(0),
  prescriptionItemId: uuid("prescription_item_id"),
}, (t) => [index("sale_lines_sale_idx").on(t.saleId), index("sale_lines_product_idx").on(t.productId)]);

export const payments = pgTable("payments", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  saleId: uuid("sale_id").references(() => sales.id),
  customerId: uuid("customer_id").references(() => customers.id), // set for account repayments
  amountMinor: integer("amount_minor").notNull(),
  method: payMethodEnum("method").notNull(),
  status: payStatusEnum("status").notNull().default("succeeded"),
  reference: text("reference"), // MoMo transaction id, card slip no.
  provider: text("provider"), // paystack | flutterwave | manual
  providerRef: text("provider_ref").unique(),
  receiptNo: text("receipt_no"),
  receivedBy: uuid("received_by"),
  receivedAt: ts("received_at").notNull().defaultNow(),
  clientId: text("client_id"),
  refundedAt: ts("refunded_at"),
  refundedBy: uuid("refunded_by"),
  refundReason: text("refund_reason"),
}, (t) => [index("payments_day_idx").on(t.tenantId, t.branchId, t.receivedAt), index("payments_sale_idx").on(t.saleId), uniqueIndex("payments_client_uq").on(t.tenantId, t.clientId)]);

export const saleReturns = pgTable("sale_returns", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  saleId: uuid("sale_id").notNull().references(() => sales.id),
  returnNo: text("return_no").notNull(),
  reason: text("reason").notNull(),
  restock: boolean("restock").notNull().default(true), // false = damaged / opened: write off instead
  refundMinor: money("refund_minor"),
  refundMethod: payMethodEnum("refund_method").notNull().default("cash"),
  lines: jsonb("lines").$type<{ saleLineId: string; baseQty: number; refundMinor: number }[]>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("sale_return_no_uq").on(t.tenantId, t.returnNo)]);

/** Held (parked) sales: a cart kept on the server so another till or the same till can resume it. */
export const heldSales = pgTable("held_sales", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  label: text("label").notNull(),
  cart: jsonb("cart").notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const cashUps = pgTable("cash_ups", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  day: date("day").notNull(),
  userId: uuid("user_id").notNull(),
  expected: jsonb("expected").$type<Record<string, number>>().notNull(),
  countedCashMinor: money("counted_cash_minor"),
  countedMomoMinor: integer("counted_momo_minor"),
  varianceMinor: integer("variance_minor").notNull().default(0),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const expenses = pgTable("expenses", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  category: text("category").notNull(),
  description: text("description"),
  paidTo: text("paid_to"),
  amountMinor: integer("amount_minor").notNull(),
  method: payMethodEnum("method").notNull().default("cash"),
  day: date("day").notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

// ---------- Insurance / HMO claims ----------
export const claims = pgTable("claims", {
  id: id(),
  tenantId: tenantId(),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  batchNo: text("batch_no").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: claimStatusEnum("status").notNull().default("draft"),
  totalClaimedMinor: money("total_claimed_minor"),
  totalPaidMinor: money("total_paid_minor"),
  submittedAt: ts("submitted_at"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const claimItems = pgTable("claim_items", {
  id: id(),
  tenantId: tenantId(),
  claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  saleId: uuid("sale_id").notNull().references(() => sales.id),
  amountClaimedMinor: money("amount_claimed_minor"),
  amountPaidMinor: money("amount_paid_minor"),
  status: text("status").notNull().default("pending"), // pending | paid | partially_paid | rejected
  rejectionReason: text("rejection_reason"),
}, (t) => [uniqueIndex("claim_sale_uq").on(t.saleId)]);

// ---------- Compliance ----------
/**
 * Controlled-drug register (append-only, enforced by trigger). One row per movement of a controlled product,
 * with the running balance for that product at that branch, in the format inspectors expect.
 */
export const controlledRegister = pgTable("controlled_register", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  productId: uuid("product_id").notNull().references(() => products.id),
  batchId: uuid("batch_id").references(() => stockBatches.id),
  entryNo: integer("entry_no").notNull(), // sequential per product per branch
  kind: text("kind").notNull(), // received | supplied | returned_by_patient | returned_to_supplier | destroyed | adjusted | transfer_in | transfer_out
  qtyIn: integer("qty_in").notNull().default(0),
  qtyOut: integer("qty_out").notNull().default(0),
  balance: integer("balance").notNull(),
  partyName: text("party_name"), // patient or supplier
  partyAddress: encrypted("party_address"),
  prescriberName: text("prescriber_name"),
  prescriberRegNo: text("prescriber_reg_no"),
  rxNo: text("rx_no"),
  docRef: text("doc_ref"), // SL-… / GRN-… / invoice no.
  enteredBy: uuid("entered_by").notNull(),
  witnessName: text("witness_name"), // required for destruction
  note: text("note"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("cd_register_entry_uq").on(t.branchId, t.productId, t.entryNo)]);

export const alerts = pgTable("alerts", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  kind: alertKindEnum("kind").notNull(),
  productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => stockBatches.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail"),
  valueMinor: integer("value_minor").notNull().default(0), // stock value at risk
  dueOn: date("due_on"),
  status: alertStatusEnum("status").notNull().default("open"),
  dedupeKey: text("dedupe_key").notNull(),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  resolution: text("resolution"), // discounted | transferred | returned | written_off | ordered | dismissed
  createdAt: createdAt(),
}, (t) => [uniqueIndex("alerts_dedupe_uq").on(t.tenantId, t.dedupeKey), index("alerts_open_idx").on(t.tenantId, t.branchId, t.status, t.kind)]);

/** Product recall notices (platform-wide, maintained by the PharmaStock team from regulator feeds). */
export const recalls = pgTable("recalls", {
  id: id(),
  country: text("country"), // null = all countries
  productName: text("product_name").notNull(),
  genericName: text("generic_name"),
  manufacturer: text("manufacturer"),
  batchNos: text("batch_nos").array().notNull().default(sql`'{}'::text[]`), // empty = every batch
  reason: text("reason").notNull(),
  source: text("source"), // regulator notice reference / URL
  publishedOn: date("published_on").notNull(),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

// ---------- Delivery ----------
export const deliveries = pgTable("deliveries", {
  id: id(),
  tenantId: tenantId(),
  branchId: branchId(),
  saleId: uuid("sale_id").references(() => sales.id),
  customerId: uuid("customer_id").references(() => customers.id),
  address: text("address").notNull(),
  phone: text("phone"),
  rider: text("rider"),
  feeMinor: money("fee_minor"),
  status: text("status").notNull().default("pending"), // pending | out | delivered | failed | cancelled
  notes: text("notes"),
  dispatchedAt: ts("dispatched_at"),
  deliveredAt: ts("delivered_at"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [index("deliveries_status_idx").on(t.tenantId, t.branchId, t.status)]);

// ---------- Supplier portal ----------
/** Signed link a supplier opens (no account) to see and confirm a purchase order. */
export const supplierLinks = pgTable("supplier_links", {
  id: id(),
  tenantId: tenantId(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  poId: uuid("po_id").references(() => purchaseOrders.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
});

// ---------- Messaging ----------
export const messageTemplates = pgTable("message_templates", {
  id: id(),
  tenantId: tenantId(),
  key: text("key").notNull(),
  language: text("language").notNull().default("en"),
  body: text("body").notNull(),
  waTemplateName: text("wa_template_name"), // approved WhatsApp template name, if any
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("tpl_uq").on(t.tenantId, t.key, t.language)]);

export const messageLog = pgTable("message_log", {
  id: id(),
  tenantId: tenantId(),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  channel: channelEnum("channel").notNull(),
  to: text("to").notNull(),
  templateKey: text("template_key"),
  purpose: text("purpose").notNull(), // receipt | refill | operations | purchase_order | marketing
  body: text("body").notNull(),
  status: msgStatusEnum("status").notNull().default("queued"),
  provider: text("provider"),
  providerId: text("provider_id"),
  error: text("error"),
  direction: text("direction").notNull().default("out"), // out | in
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
}, (t) => [index("msg_tenant_idx").on(t.tenantId, t.createdAt), index("msg_provider_idx").on(t.providerId)]);

export const jobs = pgTable("jobs", {
  id: id(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  runAt: ts("run_at").notNull().defaultNow(),
  status: jobStatusEnum("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  dedupeKey: text("dedupe_key").unique(),
  lockedAt: ts("locked_at"),
  createdAt: createdAt(),
}, (t) => [index("jobs_due_idx").on(t.status, t.runAt)]);

export const documents = pgTable("documents", {
  id: id(),
  tenantId: tenantId(),
  entity: text("entity").notNull(), // prescription | goods_receipt | supplier_return | import
  entityId: uuid("entity_id"),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedBy: uuid("uploaded_by"),
  createdAt: createdAt(),
});

// ---------- Platform / API ----------
export const apiKeys = pgTable("api_keys", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
});

export const webhooks = pgTable("webhooks", {
  id: id(),
  tenantId: tenantId(),
  url: text("url").notNull(),
  secret: encrypted("secret").notNull(),
  events: text("events").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: id(),
  tenantId: tenantId(),
  webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  responseCode: integer("response_code"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createdAt(),
});

/** Per-tenant provider credentials. Secrets are encrypted. Falls back to platform env config. */
export const integrations = pgTable("integrations", {
  id: id(),
  tenantId: tenantId(),
  provider: text("provider").notNull(), // whatsapp | twilio | africastalking | paystack | resend
  config: encrypted("config").notNull(), // JSON
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("integration_uq").on(t.tenantId, t.provider)]);

export const exportJobs = pgTable("export_jobs", {
  id: id(),
  tenantId: tenantId(),
  requestedBy: uuid("requested_by").notNull(),
  kind: text("kind").notNull().default("full"), // full | accounting
  status: text("status").notNull().default("pending"),
  storageKey: text("storage_key"),
  error: text("error"),
  createdAt: createdAt(),
  completedAt: ts("completed_at"),
});

export const billingEvents = pgTable("billing_events", {
  id: id(),
  tenantId: tenantId(),
  type: text("type").notNull(), // charge.success | subscription.disable | plan.change | setup.paid ...
  amountMinor: integer("amount_minor"),
  currency: text("currency"),
  providerRef: text("provider_ref").unique(),
  data: jsonb("data"),
  createdAt: createdAt(),
});

export const counters = pgTable("counters", {
  tenantId: tenantId(),
  key: text("key").notNull(),
  value: integer("value").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.key] })]);

// ---------- Platform (PharmaStock team) ----------
export const platformAdmins = pgTable("platform_admins", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: platformRoleEnum("role").notNull().default("support"),
  currency: text("currency"),
  totpSecret: encrypted("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const platformSessions = pgTable("platform_sessions", {
  id: text("id").primaryKey(),
  adminId: uuid("admin_id").notNull().references(() => platformAdmins.id, { onDelete: "cascade" }),
  mfaPending: boolean("mfa_pending").notNull().default(true),
  expiresAt: ts("expires_at").notNull(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

/** Exchange rates: units of `currency` per 1 USD. Refreshed daily unless `locked`. */
export const fxRates = pgTable("fx_rates", {
  currency: text("currency").primaryKey(),
  perUsd: doublePrecision("per_usd").notNull(),
  locked: boolean("locked").notNull().default(false),
  source: text("source").notNull().default("default"),
  updatedAt: updatedAt(),
});

/** Local subscription price list per currency (minor units). Missing currencies use converted USD list prices. */
export const priceBook = pgTable("price_book", {
  currency: text("currency").primaryKey(),
  starter: integer("starter").notNull(),
  pro: integer("pro").notNull(),
  chainPerBranch: integer("chain_per_branch").notNull(),
  setupBasic: integer("setup_basic").notNull(),
  setupStandard: integer("setup_standard").notNull(),
  setupFull: integer("setup_full").notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: updatedAt(),
});

// ---------- Audit (separate schema, append-only) ----------
export const audit = pgSchema("audit");
export const auditLog = audit.table("log", {
  id: id(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id"),
  action: text("action").notNull(), // view | create | update | delete | void | price | adjust | export | login | print | send
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  customerId: uuid("customer_id"),
  details: jsonb("details"),
  ip: text("ip"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_tenant_idx").on(t.tenantId, t.at), index("audit_customer_idx").on(t.customerId, t.at), index("audit_action_idx").on(t.tenantId, t.action, t.at)]);

/** Every action taken by the PharmaStock team (append-only). */
export const platformAudit = audit.table("platform_log", {
  id: id(),
  adminId: uuid("admin_id"),
  action: text("action").notNull(),
  tenantId: uuid("tenant_id"),
  entity: text("entity"),
  entityId: text("entity_id"),
  details: jsonb("details"),
  ip: text("ip"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("platform_audit_at_idx").on(t.at), index("platform_audit_tenant_idx").on(t.tenantId, t.at)]);

export type Role = (typeof roleEnum.enumValues)[number];
export type Schedule = (typeof scheduleEnum.enumValues)[number];
export type PayMethod = (typeof payMethodEnum.enumValues)[number];
export type PlatformRole = (typeof platformRoleEnum.enumValues)[number];
export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductUnit = typeof productUnits.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type StockBatch = typeof stockBatches.$inferSelect;
