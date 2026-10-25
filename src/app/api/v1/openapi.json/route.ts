import { RATE_LIMIT } from "@/lib/api-auth";

const errors = { 401: { description: "Missing/invalid API key" }, 403: { description: "Plan lacks API access, key lacks the scope, or the account is read-only (writes)" }, 429: { description: `More than ${RATE_LIMIT} requests/minute` } };
const page = (item: string) => ({ type: "object", properties: { data: { type: "array", items: { $ref: `#/components/schemas/${item}` } }, nextCursor: { type: ["string", "null"] } } });
const q = (name: string, description: string, schema: object = { type: "string" }) => ({ name, in: "query", description, schema });
const list = (scope: string, item: string, summary: string, extra: object[] = []) => ({
  summary, security: [{ bearer: [scope] }], parameters: [{ $ref: "#/components/parameters/limit" }, { $ref: "#/components/parameters/cursor" }, ...extra],
  responses: { 200: { description: "Page of results", content: { "application/json": { schema: page(item) } } }, 400: { description: "Bad query parameter" }, ...errors },
});
const ref = (item: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${item}` } } } });
const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const one = (scope: string, item: string, summary: string) => ({ summary, security: [{ bearer: [scope] }], parameters: [idParam], responses: { 200: { description: "OK", ...ref(item) }, 404: { description: "Not found" }, ...errors } });
const write = (scope: string, input: string, item: string, summary: string, created = true, path = false) => ({
  summary, security: [{ bearer: [scope] }], ...(path ? { parameters: [idParam] } : {}), requestBody: { required: true, ...ref(input) },
  responses: { [created ? 201 : 200]: { description: created ? "Created" : "Updated", ...ref(item) }, 422: { description: "Validation error ({ error, issues })" }, ...errors },
});

const s = { type: "string" }, ns = { type: ["string", "null"] }, int = { type: "integer" }, nint = { type: ["integer", "null"] }, bool = { type: "boolean" };
const uuid = { type: "string", format: "uuid" }, nuuid = { type: ["string", "null"], format: "uuid" }, dt = { type: "string", format: "date-time" }, nd = { type: ["string", "null"], format: "date" };
const money = (d = "Minor units (pesewas, kobo, cents)") => ({ type: "integer", description: d });
const schedule = { enum: ["otc", "pharmacy", "pom", "controlled", "non_drug"] };
const unitIn = { type: "object", required: ["name", "factor", "sellPriceMinor"], properties: { name: s, factor: { ...int, description: "Base units per pack" }, sellPriceMinor: money(), isDefault: bool, barcodes: { type: "array", items: s } } };
const productIn = { name: s, genericName: ns, strength: ns, form: ns, manufacturer: ns, schedule, baseUnit: s, taxBp: { ...nint, description: "Basis points; null = pharmacy default" }, reorderLevel: int, reorderQty: int, shelf: ns };
const customerIn = { name: s, phone: { ...ns, description: "Normalised to E.164 with the pharmacy's country code" }, email: ns, dob: nd, sex: { enum: ["female", "male", "other", null] }, address: ns, memberNo: ns, preferredChannel: { enum: ["whatsapp", "sms", "email"] } };

const spec = {
  openapi: "3.1.0",
  info: {
    title: "PharmaStock API", version: "1.0.0",
    description: [
      "Read and write your pharmacy's data (Chain plan). Authenticate with `Authorization: Bearer ps_live_…` from Settings → API keys; each key has scopes `resource:read|write`.",
      "Money is integer minor units in the pharmacy's currency. Stock quantities are base units (tablets, bottles); packs are `units` with a `factor`.",
      "Lists are ordered by id: pass `nextCursor` back as `cursor`. Writes are refused while the account is read-only (unpaid); reads always work.",
      "Real-time events (sale.completed, sale.voided, sale.returned, payment.received, stock.*, product.*, purchase_order.sent, alert.raised, customer.created) are delivered by webhooks (Settings → Webhooks), signed with `X-PharmaStock-Signature: sha256=<HMAC of body>`.",
    ].join("\n\n"),
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Scopes: products:read|write, stock:read, sales:read|write, customers:read|write, suppliers:read, purchase_orders:read, alerts:read, recalls:read" } },
    parameters: { limit: { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, cursor: { name: "cursor", in: "query", schema: { type: "string" } } },
    schemas: {
      Product: { type: "object", properties: { id: uuid, ...productIn, categoryId: nuuid, preferredSupplierId: nuuid, active: bool, createdAt: dt, updatedAt: dt,
        units: { type: "array", items: { type: "object", properties: { id: uuid, name: s, factor: int, sellPriceMinor: money(), sellable: bool, isDefault: bool, barcodes: { type: "array", items: s } } } } } },
      ProductInput: { type: "object", required: ["name"], additionalProperties: false, properties: { ...productIn, units: { type: "array", items: unitIn, description: "Defaults to one 'unit' pack of factor 1" } } },
      ProductPatch: { type: "object", additionalProperties: false, properties: { ...productIn, active: bool, prices: { type: "array", description: "Price changes are recorded in price history", items: { type: "object", required: ["unitId", "sellPriceMinor"], properties: { unitId: uuid, sellPriceMinor: money() } } } } },
      StockLevel: { type: "object", properties: { productId: uuid, name: s, strength: ns, baseUnit: s, branchId: nuuid, onHand: int, sellable: int, blocked: { ...int, description: "Expired or quarantined" }, valueMinor: money("At batch cost"), nextExpiry: nd } },
      Batch: { type: "object", properties: { id: uuid, productId: uuid, branchId: uuid, batchNo: s, mfgDate: nd, expiry: nd, qtyOnHand: int, unitCostMinor: { type: "number", description: "Cost per base unit (fractional minor units)" }, supplierId: nuuid, receivedAt: dt, quarantined: bool, quarantineReason: ns } },
      Sale: { type: "object", properties: { id: uuid, saleNo: s, branchId: uuid, status: { enum: ["completed", "partially_returned", "returned", "voided"] }, customerId: nuuid, prescriptionId: nuuid, payerId: nuuid,
        subtotalMinor: money(), discountMinor: money(), taxMinor: money(), totalMinor: money(), payerPortionMinor: money(), paidMinor: money(), creditMinor: money(), changeMinor: money(), offline: bool, clientId: ns, cashierId: nuuid, soldAt: dt,
        lines: { type: "array", description: "Only on GET /sales/{id}", items: { type: "object", properties: { id: uuid, productId: uuid, unitId: uuid, description: s, qty: int, baseQty: int, unitPriceMinor: money(), discountMinor: money(), taxBp: int, taxMinor: money(), totalMinor: money(), returnedBaseQty: int, batches: { type: "array", items: { type: "object", properties: { batchId: uuid, qty: int } } } } } },
        payments: { type: "array", description: "Only on GET /sales/{id}", items: { type: "object", properties: { id: uuid, method: s, amountMinor: money(), status: s, reference: ns, receiptNo: ns, receivedAt: dt } } } } },
      SaleInput: { type: "object", required: ["clientId", "lines"], description: "Recorded by the same engine as the till (FEFO, tax, credit limit, loyalty, controlled-drug register). The staff member who created the API key is the cashier, so their discount limit applies and pharmacy-only medicines need that person to be a pharmacist. Resending the same clientId returns the original sale with 200.",
        properties: { clientId: { type: "string", minLength: 8, maxLength: 100, description: "Your idempotency key" }, branchId: { ...uuid, description: "Defaults to the main branch" }, customerId: uuid, prescriptionId: uuid, payerId: uuid, memberNo: s,
          lines: { type: "array", items: { type: "object", required: ["productId", "unitId", "qty"], properties: { productId: uuid, unitId: uuid, qty: { ...int, description: "Packs of unitId" }, discountMinor: money(), prescriptionItemId: uuid } } },
          saleDiscountMinor: money(), payments: { type: "array", items: { type: "object", required: ["method", "amountMinor"], properties: { method: { enum: ["cash", "mobile_money", "card", "bank"] }, amountMinor: money(), reference: s } } },
          creditMinor: money("Put on the customer's account (within their credit limit)"), redeemPoints: int, approverId: { ...uuid, description: "Supervising pharmacist when the key owner is not one (no PIN over the API: use a pharmacist's key instead)" }, soldAt: { ...dt, description: "When the sale really happened" } } },
      Customer: { type: "object", properties: { id: uuid, customerNo: s, ...customerIn, creditLimitMinor: money(), balanceMinor: money("Owed to the pharmacy"), loyaltyPoints: int, payerId: nuuid, messagingConsent: bool, optedOut: bool, createdAt: dt } },
      CustomerInput: { type: "object", required: ["name"], additionalProperties: false, properties: customerIn },
      CustomerPatch: { type: "object", additionalProperties: false, properties: customerIn },
      Supplier: { type: "object", properties: { id: uuid, name: s, contactName: ns, phone: ns, email: ns, address: ns, licenceNo: ns, paymentTermsDays: int, returnMinDaysToExpiry: int, returnWithinDaysOfDelivery: int, leadTimeDays: int, active: bool, createdAt: dt } },
      PurchaseOrder: { type: "object", properties: { id: uuid, poNo: s, branchId: uuid, supplierId: uuid, status: { enum: ["draft", "sent", "confirmed", "partially_received", "received", "cancelled"] }, expectedAt: nd, totalMinor: money(), sentAt: { type: ["string", "null"], format: "date-time" }, sentVia: ns, confirmedAt: { type: ["string", "null"], format: "date-time" }, supplierNote: ns, createdAt: dt,
        lines: { type: "array", description: "Only on GET /purchase-orders/{id}", items: { type: "object", properties: { id: uuid, productId: uuid, unitId: uuid, qty: int, unitCostMinor: money(), supplierQty: nint, supplierCostMinor: nint, receivedBaseQty: int } } } } },
      Alert: { type: "object", properties: { id: uuid, branchId: uuid, kind: { enum: ["expiry_90", "expiry_60", "expiry_30", "expired", "low_stock", "out_of_stock", "recall", "return_window", "stock_discrepancy", "refill_due", "sale_review"] }, status: { enum: ["open", "done", "dismissed"] }, title: s, detail: ns, valueMinor: money("Stock value at risk, at cost"), dueOn: nd, productId: nuuid, batchId: nuuid, customerId: nuuid, resolution: ns, resolvedAt: { type: ["string", "null"], format: "date-time" }, createdAt: dt } },
      Recall: { type: "object", properties: { id: uuid, country: ns, productName: s, genericName: ns, manufacturer: ns, batchNos: { type: "array", items: s }, reason: s, source: ns, publishedOn: { type: "string", format: "date" },
        matchedBatches: { type: "array", items: { type: "object", properties: { alertId: uuid, alertStatus: s, batchId: uuid, branchId: uuid, productId: uuid, batchNo: s, expiry: nd, qtyOnHand: int, quarantined: bool } } } } },
    },
  },
  paths: {
    "/products": { get: list("products:read", "Product", "List products with pack sizes, prices and barcodes", [q("q", "Search brand or generic name"), q("active", "true (default), false or all")]), post: write("products:write", "ProductInput", "Product", "Create a product") },
    "/products/{id}": { get: one("products:read", "Product", "Get a product"), patch: write("products:write", "ProductPatch", "Product", "Update a product or its prices", false, true) },
    "/stock": { get: list("stock:read", "StockLevel", "Stock on hand per product per branch (cursor is a product id)", [q("productId", "Filter", uuid), q("branchId", "Filter", uuid)]) },
    "/stock/batches": { get: list("stock:read", "Batch", "Batches in stock with batch number and expiry", [q("productId", "Filter", uuid), q("branchId", "Filter", uuid), q("expiringWithinDays", "Only batches expiring within N days (expired included)", int)]) },
    "/sales": { get: list("sales:read", "Sale", "List sales", [q("from", "soldAt ≥ (ISO date/time)", dt), q("to", "soldAt < (ISO date/time)", dt), q("branchId", "Filter", uuid), q("customerId", "Filter", uuid)]),
      post: { ...write("sales:write", "SaleInput", "Sale", "Record a sale (idempotent on clientId)"), responses: { 200: { description: "Already recorded (same clientId)", ...ref("Sale") }, 201: { description: "Created", ...ref("Sale") }, 409: { description: "The key's creator is inactive" }, 422: { description: "Validation or business rule (stock, credit limit, discount limit, prescription)" }, ...errors } } },
    "/sales/{id}": { get: one("sales:read", "Sale", "Get a sale with lines (batches) and payments") },
    "/customers": { get: list("customers:read", "Customer", "List customers (audited)", [q("phone", "Exact phone (normalised)"), q("q", "Search name or customer number")]), post: write("customers:write", "CustomerInput", "Customer", "Create a customer (messaging consent is recorded at the counter, not via API)") },
    "/customers/{id}": { get: one("customers:read", "Customer", "Get a customer (audited)"), patch: write("customers:write", "CustomerPatch", "Customer", "Update a customer", false, true) },
    "/suppliers": { get: list("suppliers:read", "Supplier", "List suppliers with return terms", [q("active", "true (default) or all")]) },
    "/purchase-orders": { get: list("purchase_orders:read", "PurchaseOrder", "List purchase orders", [q("status", "Filter"), q("supplierId", "Filter", uuid), q("branchId", "Filter", uuid)]) },
    "/purchase-orders/{id}": { get: one("purchase_orders:read", "PurchaseOrder", "Get a purchase order with lines") },
    "/alerts": { get: list("alerts:read", "Alert", "Expiry, stock, recall, return-window and refill alerts", [q("status", "open (default), done, dismissed or all"), q("kind", "Filter"), q("branchId", "Filter", uuid)]) },
    "/recalls": { get: list("recalls:read", "Recall", "Recall notices for your country with the batches matched and quarantined here", [q("matched", "true = only recalls that matched your stock")]) },
  },
};

export function GET() {
  return Response.json(spec);
}
