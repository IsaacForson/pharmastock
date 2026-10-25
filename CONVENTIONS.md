# PharmaStock conventions

Pharmacy POS + inventory for independent pharmacies, drug shops and 2–10 branch chains (Ghana, Nigeria, Kenya first; country rules in `src/lib/compliance.ts`). Batches, expiry, FEFO at the counter, reorder, prescriptions, controlled-drug register, offline-first till. Next.js 16 App Router (Cache Components on), TypeScript, Tailwind v4, Drizzle ORM + Postgres, server actions.

## Run
- `scripts/db-local.sh` starts a project-local Postgres on :54339 (`reset` to wipe). Databases `pharmastock` and `pharmastock_test`.
- `npx tsx scripts/migrate.mts` (add `--test` for the test DB) applies drizzle migrations + `src/db/rls.sql`.
- `pnpm dev` — app on :3000. `npx tsc --noEmit` — typecheck. `pnpm test` — vitest (uses the test DB).
- Schema change: edit `src/db/schema.ts`, then `npx drizzle-kit generate --name <what>` and migrate.

## Data access (non-negotiable)
- Tenant data ONLY through `tx(ctx, async (t) => …)` from `@/lib/auth` — runs as a non-owner role with Postgres RLS on `app.tenant_id`. Every insert must set `tenantId: ctx.tenant.id`.
- `adminDb()` bypasses RLS: only for auth, signup, background workers, inbound webhooks, and public token pages (supplier portal), and then always filter by tenant explicitly.
- Pages: `const ctx = await requireCtx("perm")` (redirects). Server actions: `const ctx = await requireWrite("perm")` (also blocks read-only accounts). Permissions in `src/lib/permissions.ts`; plan features in `src/lib/plans.ts` (`hasFeature(ctx.tenant, "…")`).
- `ctx.branchId` is the branch the user is working at; stock, sales and cash are per branch. Owners/managers on Chain can see consolidated views.
- Audit every stock, price, sale and customer-record change with `audit(t, ctx, action, entity, id, { customerId, details })`. Reads of prescriptions are audited too.
- Sensitive free text (allergies, diagnosis, notes, addresses on the register) uses the `encrypted(...)` column type — not searchable in SQL.
- Money is integer minor units (`*Minor`); batch unit cost is a float (`unitCostMinor`, cost per base unit). Format with `money(minor, ctx.tenant.currency)`; parse form input with `zMoney`.
- Quantities in stock tables are **base units** (tablet, bottle). Packs come from `product_units` (`factor` = base units per pack); show quantities to people in packs + loose units where helpful.
- Dates: store timestamptz; show with `dateTime/dateOnly/timeOnly(d, ctx.tenant.timezone)`; "today" is `localDay(tz)`; `dayRange(day, tz)` for queries. Expiry dates are `date` strings (YYYY-MM-DD).
- Phone numbers stored E.164 via `e164(input, ctx.tenant.country)`.
- Human numbers via `nextNumber(t, tenantId, key)`: sale SL-, receipt RCT-, grn GRN-, po PO-, transfer TRF-, return RTN-, supplier_return SRN-, stocktake STK-, rx RX-, customer C-, claim CLM-.

## Stock ledger (`@/lib/stock`) — the only way stock changes
- Never update `stock_batches.qty_on_hand` directly. Use `receiveIntoBatch` (receive / transfer in / found stock), `takeFefo` (sale / transfer out / supplier return, FEFO across sellable batches), `adjustBatch` (signed change to one batch: count fix, damage, expiry write-off, supplier return of a chosen batch), `returnToBatch` (put back into the batch it came from). Each writes a `stock_movements` row and, for controlled drugs, a `controlled_register` entry with the running balance (destruction needs `register.witnessName`).
- Sellable = in stock, not expired (expiry ≥ today), not quarantined. Stock can never go negative (guard + CHECK constraint).
- `onHand(t, productId, branchId)` for totals; FEFO maths is `allocateFefo` in `@/lib/pos-math` (pure, shared with the browser).

## Sales (`@/lib/sales`)
- `createSale(t, ctx, input, { offline })` is the one sale path (till action, offline sync, API). It validates input (`saleInput` zod), prices, discounts within `users.maxDiscountBp`, tax (`pos-math`), pharmacist supervision for P/POM/CD (`compliance.NEEDS_PHARMACIST`, approver PIN), prescription for controlled drugs, payer share, loyalty, credit limit, FEFO stock, payments, prescription fills, audit and the `sale.completed` webhook. Idempotent on `clientId`.
- `returnSale`, `voidSale` (today only), `recordRepayment` (customer account).
- Pure maths for both server and browser: `lineTotals`, `saleTotals`, `spreadDiscount`, `loyaltyEarned`, `allocateFefo` in `@/lib/pos-math`.

## Server actions
- File `actions.ts` with `"use server"`; export only async functions.
- Signature `(prev: ActionState, fd: FormData) => Promise<ActionState>`, body wrapped in `run(async () => { … })`. Parse with zod over `formObject(fd)`. Throw `UserError("message")` for user-facing errors. Return `{ ok: true, id }` to redirect via `ActionForm onSuccessHref="/x/{id}"`.
- Call `revalidatePath(...)` for pages whose data changed.

## UI
- Server components by default; `@/components/ui` and `@/components/form` (see DESIGN.md: the "Dispensary" system — light-first, ruled sheets, IBM Plex, top-bar navigation). Barcode input: `useWedgeScanner` (USB/Bluetooth scanners) and `CameraScanner` (phone camera) from `@/components/scanner`.
- Pages live under `src/app/(app)/<module>/`; the layout handles auth, nav and Suspense. Use `PageProps<"/route">` / `RouteContext<"/api/...">` global types (run `npx next typegen` after adding routes).
- Printable documents (receipts, labels, purchase orders, registers, GRNs, credit notes) are print-styled pages with the pharmacy letterhead + `PrintButton`. Thermal receipts are 80mm wide. Use `print:hidden` for chrome.
- Counter staff are busy: large click targets, keyboard first (scan → Enter), few fields, sensible defaults.

## Shared libs (reuse, don't duplicate)
- `@/lib/compliance`: `rulesFor(country)` (regulator names, register title, schedule labels, suggested tax, mobile money names), `NEEDS_PHARMACIST`, `NEEDS_PRESCRIPTION`.
- `@/lib/messaging`: `queueCustomerMessage` (consent-checked: refill/marketing/balance need opt-in, opt-out always wins), `queueDirectMessage` (owner summary, supplier POs), `sendNow`, `DEFAULT_TEMPLATES`, `render`.
- `@/lib/jobs`: `enqueue` + job types. `@/lib/events`: `emit` (outgoing webhooks; events listed in `WEBHOOK_EVENTS`).
- `@/lib/storage`: putFile/getFile/deleteTenantFiles. `@/lib/crypto`: encrypt, hashPassword/verifyPassword (also staff PINs), tokens, TOTP.

## Product rules
- The till never blocks a sale because the internet is down. Offline sales sync later and are never refused for stock; shortfalls raise a `stock_discrepancy` alert.
- FEFO is enforced at the counter, not just reported. Expired and quarantined (recalled) batches cannot be sold.
- The software supports but does not replace pharmacist judgment: no dosing or interaction advice.
- The controlled-drug register is append-only (DB trigger); corrections are new entries.
- Reminders, backups and data export are never paid add-ons. Unpaid accounts become read-only, never locked out of their data. Free data export always.
- Every customer message records its purpose; refill reminders need opt-in; opt-out wins.

## Two kinds of admin
- **Manager** (role `admin`): runs the pharmacy like the owner, except plan/payment (`subscription.manage`) and supplying P/POM/CD. Only owners can create, change or deactivate owners. Owner console: `/owner` (`admin.console`).
- **PharmaStock team ("Control")** at `/admin`: separate `platform_admins` table, `ps_admin` cookie, mandatory TOTP, roles `super_admin` / `finance` / `support` (`src/lib/platform-auth.ts`). Uses `adminDb()` across pharmacies; every action goes to append-only `audit.platform_log` via `platformLog`. Also maintains platform-wide `recalls`. First admin: `npx tsx scripts/create-admin.mts --email you@x --name "You"`.
- Support view = a 1-hour read-only pharmacy session (`sessions.impersonatedBy`); suspension (`tenants.suspendedAt`) is for abuse only.
- Deleting a whole account goes through `purgeTenant()` in `@/lib/provision` (lifts the register guard for that tenant only).
