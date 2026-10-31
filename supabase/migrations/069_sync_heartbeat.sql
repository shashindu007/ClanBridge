-- 069 — Keep the half-hourly sync running half-hourly.
--
-- LIVE-ONLY, like 029, 035 and 043: pg_cron, pg_net and Vault exist on Supabase,
-- not in the PGlite harness. Listed in LIVE_ONLY_MIGRATIONS (test/pg-harness.ts)
-- so `migrations:apply` cannot silently skip it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS.
--
-- sync-clans.yml is scheduled every 30 minutes, 48 runs a day. GitHub's schedule
-- on a public repository is best-effort: October 2026 measured 5 to 15 runs a
-- day, a median gap of 165 minutes and a worst of 429. That is not only stale
-- pages. /currentwar stops describing a war once the next one starts, so 6 of 36
-- wars lost their last attacks for good, and members were charged for them.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT IT DOES, AND WHAT IT DOES NOT.
--
-- Asks GitHub to run the same workflow, every 30 minutes, from a clock that keeps
-- time. The sync still runs on GitHub Actions, never here (R2), with the same
-- secrets and code path as a scheduled run. Nothing in this file reads game data
-- or holds a game or service key.
--
-- The workflow's cron stays as the backup, and its concurrency group means the
-- two cannot overlap. :02 and :32 sit between GitHub's :17 and :47.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ONE SECRET. A GitHub fine-grained token with one permission, Actions (read
-- and write), on this repository only. The same kind as GITHUB_DISPATCH_TOKEN in
-- lib/github.ts, and the same blast radius: a leak lets someone run these
-- idempotent workflows. It lives in Vault, never in this public file. Add it once
-- in the Supabase SQL editor:
--
--   select vault.create_secret('<the token>', 'github_dispatch_token');
--
-- UNTIL THEN THIS DOES NOTHING, deliberately. The function returns without
-- calling anyone, and GitHub's own schedule carries on as it did.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.dispatch_sync_clans()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
begin
  select decrypted_secret into token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token'
  limit 1;

  if token is null or token = '' then
    return;
  end if;

  perform net.http_post(
    url := 'https://api.github.com/repos/shashindu007/ClanBridge/actions/workflows/sync-clans.yml/dispatches',
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || token,
      'Content-Type', 'application/json',
      'User-Agent', 'clanbridge-heartbeat',
      'X-GitHub-Api-Version', '2022-11-28'
    ),
    body := '{"ref":"main"}'::jsonb
  );
end;
$$;

-- Only the scheduler. A member able to call this could spend the workflow's runs.
revoke all on function public.dispatch_sync_clans() from public, anon, authenticated;

-- By name, so running this again replaces the job rather than adding a second.
select cron.schedule('dispatch-sync-clans', '2,32 * * * *', 'select public.dispatch_sync_clans()');
