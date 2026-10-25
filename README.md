# PharmaStock

Pharmacy point of sale and inventory for independent pharmacies, drug shops and 2–10 branch chains in Ghana, Nigeria and Kenya
(other countries are config-driven). Batches and expiry on every delivery, alerts 90/60/30 days before expiry, FEFO enforced at the
till, reorder lists from sales velocity, supplier ordering and returns, prescriptions, a controlled-drug register, an offline-first
till, a nightly WhatsApp owner summary, and free full data export.

Plans: **Starter** $15/month, **Pro** $29/month, **Chain** $19 per branch/month (minimum 3), monthly or annual (2 months free), with
local-currency price lists and a one-time setup service ($49/$99/$149). 30-day free trial, then read-only (never locked out).

## Stack
Next.js 16 (App Router, Cache Components, server actions) · TypeScript · Tailwind v4 · Drizzle ORM + PostgreSQL with row-level
security · a jobs table + worker for background work · Paystack · WhatsApp Cloud API / Africa's Talking / Twilio / Resend ·
Supabase (Postgres + Storage) or any Postgres in production. Read `CONVENTIONS.md` (data access, stock ledger, sales) and
`DESIGN.md` (UI tokens and components) before changing code; `AGENTS.md` explains why the Next.js docs in `node_modules` win.

## Run locally
```bash
pnpm install
cp .env.example .env              # fill DATABASE_URL / APP_DATABASE_URL (printed by the next step) and ENCRYPTION_KEY
scripts/db-local.sh               # project-local Postgres on :54339 with databases pharmastock and pharmastock_test
pnpm migrate && pnpm migrate:test # drizzle migrations + src/db/rls.sql
npx tsx scripts/seed-demo.mts     # Grace Community Pharmacy: 150 products, 120 days of sales, alerts (see logins it prints)
pnpm dev                          # http://localhost:3000
pnpm worker                       # background jobs: alerts, owner summary, messages, webhooks, exports
```
Other scripts:
- `npx tsx scripts/seed-owner.mts [--email you@x --country NG]` — an empty pharmacy with an owner login (prints the password).
- `npx tsx scripts/create-admin.mts --email you@x --name "You"` — first PharmaStock team (Control) admin; 2FA is set up at first sign-in at `/admin/login`.
- `pnpm typecheck`, `pnpm test` (vitest against `pharmastock_test`; DB tests create and purge their own tenant), `pnpm lint`.

Without messaging credentials, WhatsApp/SMS/email are printed to the server log in development.

## Deploy
See `docs/DEPLOY-SUPABASE.md` (database, storage, roles, worker/cron, webhooks). Netlify config is in `netlify.toml`
(`netlify/functions/cron-tick.mjs` calls `/api/cron/tick` every minute). Set every variable in `.env.example`; keep `ENCRYPTION_KEY`
backed up.

## Architecture
```
src/app/(auth)          sign up (pharmacy name, country, owner), sign in, phone codes, 2FA
src/app/(app)           the pharmacy app: dashboard, till (pos), sales, alerts, customers, prescriptions, products, stock,
                        purchasing, receiving, suppliers, transfers, register, cashup, claims, reports, ask, messages,
                        owner (owner console), settings, account
src/app/admin           "Control" for the PharmaStock team: pharmacies, revenue, price book & FX, recalls, system, team, audit
src/app/api             offline sync, search, public REST API (v1), webhooks (Paystack, WhatsApp, SMS), files, exports, cron
src/app/page.tsx …      marketing site: home, pricing (local currency), privacy, terms, security
src/db                  schema.ts (the data model), rls.sql (row-level security, append-only audit + register)
src/lib                 domain: stock (the only way stock changes), sales, pos-math (shared with the browser), compliance
                        (country rules), messaging, alerts-engine, reorder, plans/money/currency (billing), auth, platform-auth,
                        export, storage, crypto; worker/ (job handlers)
scripts                 migrate, seeds, create-admin, supabase-setup, worker
```
Key rules (details in `CONVENTIONS.md`):
- **Tenancy**: every query for pharmacy data runs in `tx(ctx, …)` as a non-owner role with Postgres RLS on the tenant; `adminDb()`
  is reserved for auth, signup, workers, webhooks and Control. A test checks every tenant table.
- **Stock ledger**: quantities change only through `@/lib/stock` (receive, FEFO take, adjust, return), each writing a movement;
  controlled drugs also write the append-only register with a running balance.
- **One sale path**: `createSale` serves the till, offline sync and the API; offline sales are never refused for stock.
- **Billing**: plans and limits in `@/lib/plans`; prices per currency in `@/lib/money` + the `price_book` table; Paystack checkout
  for subscriptions and setup, confirmed by the webhook. Chain keeps `tenants.billed_branches` in sync with active branches.
- **Your data**: unpaid accounts become read-only, never locked; full export (JSON + CSV + documents) is always free.
- **Not medical advice**: the software supports, but does not replace, pharmacist judgment.
