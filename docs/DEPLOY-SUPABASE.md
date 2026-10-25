# Running PharmaStock on Supabase

Supabase provides the **Postgres database** and **file storage**. PharmaStock keeps its own authentication (staff logins, phone codes, 2FA, the Control team login) and all business logic in the Next.js app. Supabase Auth and the Supabase Data API are **not used** — the migrations revoke the Data API roles from every table.

## 1. Create the project
1. Create a project at supabase.com. Pick the region closest to your pharmacies (e.g. `eu-west-2` London or `af-south-1` Cape Town if offered).
2. Save the **database password** you set — it's the `postgres` user's password.

## 2. Collect the connection details (Project → Connect)
| Variable | Where it comes from | Used for |
|---|---|---|
| `DATABASE_URL` | **Direct connection** (`db.<ref>.supabase.co:5432`, user `postgres`). If your host has no IPv6, use the **Session pooler** URL (port 5432 on `pooler.supabase.com`) instead. | Migrations, the background worker, sign-in and webhooks |
| `APP_DATABASE_URL` | **Transaction pooler** (port **6543** on `pooler.supabase.com`) with user **`pharmastock_app.<ref>`** and the app password you choose below | All pharmacy data (row-level security is enforced on this role) |
| `SUPABASE_URL` | Project URL (`https://<ref>.supabase.co`) | File storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key. **Server only — never expose it to browsers.** | File storage |
| `SUPABASE_STORAGE_BUCKET` | Any name, default `pharmacy-files` (private) | File storage |

Put these in the hosting provider's environment settings (and your local `.env` if you want to run against Supabase from your machine). Never paste them into chat, issues or the repo.

## 3. One-time setup
```bash
APP_DB_PASSWORD='<a long random password>' pnpm supabase:setup   # creates role pharmastock_app + private bucket
pnpm migrate                                                     # tables, row-level security, revokes Data API access
npx tsx scripts/create-admin.mts --email you@yourdomain.com --name "Your Name"   # first Control super admin
```
Then set `APP_DATABASE_URL` using the same `APP_DB_PASSWORD`.

## 4. Run
- **Web app**: deploy the Next.js app (Vercel, Fly.io, Render…) with the variables above plus everything in `.env.example` (`ENCRYPTION_KEY`, `APP_URL`, `CRON_SECRET`, Paystack, WhatsApp, SMS, email, Anthropic).
- **Background worker**: run `pnpm worker` as a long-running process (Fly/Render worker), **or** call `GET /api/cron/tick` with `Authorization: Bearer $CRON_SECRET` every minute (Vercel Cron, or the Netlify scheduled function in `netlify/functions/cron-tick.mjs`). The worker runs the nightly expiry/reorder/recall alerts, the WhatsApp owner summary, refill reminders, message delivery, webhooks and data exports.
- Point the Paystack webhook at `/api/webhooks/paystack` (subscription and setup-service payments; signed with `PAYSTACK_SECRET_KEY`) and the WhatsApp/SMS webhooks at `/api/webhooks/whatsapp` and `/api/webhooks/sms`.

## Notes
- **Keep `ENCRYPTION_KEY` safe and backed up.** Customer allergies, prescription diagnoses and notes, register addresses and integration secrets are encrypted with it; losing it makes them unreadable.
- **Backups**: enable Point-in-Time Recovery on the Supabase project and test a restore every quarter.
- **Pooler + transactions**: the app sets the pharmacy for each request with a transaction-local setting, which is compatible with the transaction pooler. Prepared statements are already disabled for it.
- **Moving local files**: if you used local-disk storage before, copy the `.storage/<tenant-id>/…` folders into the bucket with the same paths.
- **Security check after deploying**: in Supabase → Database → Roles, `anon` and `authenticated` should have no table privileges (the test suite checks this too).
- **Controlled-drug register**: it is append-only at the database level (trigger), even for the `postgres` user. Whole-account deletion goes through `purgeTenant()` (Control → Pharmacies → delete), which lifts the guard for that one pharmacy only.
- **Local demo data**: never run `scripts/seed-demo.mts` against production.
