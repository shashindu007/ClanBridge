-- Fix forward for a defect in 006_rls.sql.
--
-- 006 granted select to `anon` and `authenticated` but never granted anything to
-- `service_role`. Every sync job uses the service key, so `npm run sync:clans`
-- failed on its first contact with real Supabase:
--
--   42501  permission denied for table clans
--
-- 006 has been applied, so per section 4 it is not edited — this migration
-- corrects it.
--
-- Why PGlite never caught it: the test harness connects as superuser and only
-- switches role to `anon` or `authenticated` to exercise RLS. It never acted as
-- `service_role`, so the missing grant was invisible. That is the limitation of a
-- stand-in, stated plainly in test/pg-harness.ts, showing up in practice.

grant usage on schema public to service_role;


-- ---------------------------------------------------------------------------
-- SELECT, INSERT, UPDATE — and deliberately NOT DELETE.
--
-- R4 says nothing is ever deleted: no DELETE statements, soft delete only,
-- because destroyed CWL history cannot be re-fetched from anywhere. Withholding
-- the privilege turns that rule from a convention the code must remember into
-- something the database enforces.
--
-- If a sync job ever tries a hard delete it now fails loudly with a permission
-- error, which is exactly the outcome R4 wants. Should a genuine need for a hard
-- delete appear, it should require a deliberate new migration and a reason —
-- never be available by default to a job that runs unattended every hour.
-- ---------------------------------------------------------------------------
grant select, insert, update on all tables in schema public to service_role;

-- Tables added by later migrations must inherit the same privileges, or the next
-- feature reintroduces this exact bug.
alter default privileges in schema public
  grant select, insert, update on tables to service_role;

alter default privileges in schema public
  grant select on tables to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Sanity check after applying. Run this and confirm delete is absent:
--
--   select grantee, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'clans'
--   group by grantee;
--
-- Expect service_role to show INSERT, SELECT, UPDATE — and no DELETE.
-- ---------------------------------------------------------------------------
