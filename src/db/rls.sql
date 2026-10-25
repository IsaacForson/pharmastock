-- Applied after every migration (idempotent). Runs as the owner role.
-- Every public table with a tenant_id column gets RLS keyed on the per-transaction setting app.tenant_id.
-- The runtime role (pharmastock_app) is not the owner, so policies always apply to it.

do $$
declare r record;
begin
  for r in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE' and c.table_schema in ('public', 'audit')
  loop
    execute format('alter table %I.%I enable row level security', r.table_schema, r.table_name);
    execute format('drop policy if exists tenant_isolation on %I.%I', r.table_schema, r.table_name);
    execute format($p$create policy tenant_isolation on %I.%I using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, r.table_schema, r.table_name);
  end loop;
end $$;

-- Tenants: the app role may only see its own tenant row.
alter table public.tenants enable row level security;
drop policy if exists tenant_self on public.tenants;
create policy tenant_self on public.tenants using (id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Runtime role grants. Sessions/OTP are owner-only (handled by the auth layer).
grant usage on schema public, audit to pharmastock_app;
grant select, insert, update, delete on all tables in schema public to pharmastock_app;
revoke all on public.sessions, public.otp_codes from pharmastock_app;
grant select, update on public.tenants to pharmastock_app;
revoke insert, delete on public.tenants from pharmastock_app;
grant usage, select on all sequences in schema public to pharmastock_app;

-- Audit log is append-only for everyone: insert + select for the app, no update/delete even for the owner.
grant select, insert on audit.log to pharmastock_app;
revoke update, delete, truncate on audit.log from pharmastock_app;
create or replace function audit.block_change() returns trigger language plpgsql as $f$
begin raise exception '% is append-only', tg_table_name; end $f$;
drop trigger if exists audit_append_only on audit.log;
create trigger audit_append_only before update or delete on audit.log for each row execute function audit.block_change();

-- Platform (PharmaStock team) tables are owner-only: the pharmacy runtime role can never read them.
revoke all on public.platform_admins, public.platform_sessions from pharmastock_app;
revoke all on audit.platform_log from pharmastock_app;
drop trigger if exists platform_audit_append_only on audit.platform_log;
create trigger platform_audit_append_only before update or delete on audit.platform_log for each row execute function audit.block_change();

-- Platform-wide reference data: pharmacies may read rates, prices and recall notices; only the PharmaStock team changes them.
revoke insert, update, delete on public.fx_rates, public.price_book, public.recalls from pharmastock_app;

-- The controlled-drug register is a legal record: append-only for everyone, like the audit log.
revoke update, delete, truncate on public.controlled_register from pharmastock_app;
drop trigger if exists cd_register_append_only on public.controlled_register;
-- Only a whole-account purge (owner connection, app.purge_tenant set to that tenant) may remove its entries.
create or replace function public.cd_register_guard() returns trigger language plpgsql as $f$
begin
  if tg_op = 'DELETE' and old.tenant_id::text = current_setting('app.purge_tenant', true) then return old; end if;
  raise exception 'controlled_register is append-only';
end $f$;
create trigger cd_register_append_only before update or delete on public.controlled_register for each row execute function public.cd_register_guard();

-- Supabase: its Data API (PostgREST) roles get default privileges on new tables. PharmaStock never uses the Data API,
-- so those roles must not be able to read or write anything (OTP codes, admin accounts and price tables have no RLS).
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('revoke all on all functions in schema public from %I', r);
      execute format('revoke usage on schema audit from %I', r);
      execute format('revoke all on all tables in schema audit from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;
end $$;
