-- 077 — Verification must be proven, not just asked for.
--
--
-- THE HOLE
--
-- link_verified_player(p_tag) (016, then 032) is a definer function granted to
-- every signed-in session. It is what sets players.user_id and verified, and it
-- routes the account to that clan's leader. The Supercell token check that is
-- supposed to come first lives only in /api/verify — nothing in the database
-- knew it had happened. Any signed-in account could call
--
--   POST <supabase>/rest/v1/rpc/link_verified_player  {"p_tag": "#VICTIM"}
--
-- with the public anon key and its own session, and own a teammate's village:
-- vote as them, claim war targets as them, and lock the real owner out with
-- "already linked to another account".
--
--
-- THE FIX, AND WHY THIS SHAPE
--
-- The route proves it ran the token check by signing what it checked:
--
--   proof = hex(HMAC-SHA256(secret, "<auth.uid()>|<tag>|<issued_at>"))
--
-- and the function recomputes it. The secret is in the route's environment
-- (VERIFY_LINK_SECRET) and in private.app_secrets below, and nowhere a session
-- can read. A proof is bound to the caller (auth.uid(), never a parameter), to
-- one tag, and to a two-minute window, so one leaked proof links nothing else.
--
-- Not the service-role key: R6 keeps it off Vercel, and this is the one write
-- the web app makes on a player's behalf. A shared secret that can do exactly
-- one thing is the smaller grant.
--
-- The one-argument function is DROPPED, not left beside the new one. Postgres
-- overloads by signature, so a `create or replace` with three arguments would
-- have added a door and left the old one open.
--
--
-- DEPLOYING
--
-- After applying this, run once in the SQL editor, with the same value as the
-- Vercel environment variable VERIFY_LINK_SECRET (any long random string, e.g.
-- `openssl rand -hex 32`):
--
--   insert into private.app_secrets (name, value) values ('verify_link', '<secret>')
--   on conflict (name) do update set value = excluded.value, updated_at = now();
--
-- Until both are set, verification answers "temporarily unavailable" — closed,
-- not open.
--
--
-- ALSO IN THIS FILE
--
--   2. claim_platform_ownership() checks the owner's email itself. Until now
--      only the /admin Server Action compared it with OWNER_EMAIL, so a direct
--      RPC call from any account could take ownership of a fresh deployment.
--      The value lives in private.app_secrets as 'owner_email'; with none set,
--      nobody can claim — the same safe failure as an empty OWNER_EMAIL.
--
--   3. Notification links may not contain control characters. Browsers strip a
--      tab from a URL, so "/<TAB>/evil.example" passed 056's "no //" check and
--      arrived as "//evil.example" — an off-site link in the member's own feed.


create extension if not exists pgcrypto with schema extensions;


-- ---------------------------------------------------------------------------
-- 1. private.app_secrets
--
-- A schema PostgREST does not expose, a table no session role may touch, and
-- RLS on with no policies as a second lock. Only definer functions read it.

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.app_secrets (
  name       text primary key,
  value      text not null check (length(value) > 0),
  updated_at timestamptz not null default now()
);

alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public;

comment on table private.app_secrets is
  '077 - server-held values the definer functions check against: verify_link '
  '(the HMAC key /api/verify signs with) and owner_email. Never readable by a session.';


-- ---------------------------------------------------------------------------
-- 2. link_verified_player(tag, issued_at, proof)

revoke execute on function link_verified_player(text) from public, authenticated;
drop function if exists link_verified_player(text);

create or replace function link_verified_player(p_tag text, p_issued_at bigint, p_proof text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret    text;
  v_expected  text;
  v_player_id uuid;
  v_clan_id   uuid;
  v_owner     uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'no_session');
  end if;

  select value into v_secret from private.app_secrets where name = 'verify_link';
  if v_secret is null then
    return jsonb_build_object('ok', false, 'reason', 'not_configured');
  end if;

  if p_tag is null or p_issued_at is null or p_proof is null
     or abs(extract(epoch from now()) - p_issued_at) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'bad_proof');
  end if;

  v_expected := encode(
    extensions.hmac(auth.uid()::text || '|' || p_tag || '|' || p_issued_at::text, v_secret, 'sha256'),
    'hex');
  if v_expected <> lower(p_proof) then
    return jsonb_build_object('ok', false, 'reason', 'bad_proof');
  end if;

  -- From here on, 032's body unchanged.
  select id, clan_id, user_id
    into v_player_id, v_clan_id, v_owner
  from public.players
  where tag = p_tag
    and deleted_at is null
    and left_at is null
    and clan_id is not null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  if v_owner is not null and v_owner <> auth.uid() then
    raise exception 'player already linked to another account';
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.players
  set verified = true,
      user_id  = auth.uid()
  where id = v_player_id;

  update public.users
  set requested_clan_id = v_clan_id
  where id = auth.uid()
    and deleted_at is null
    and status = 'pending'
    and requested_clan_id is null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan_id, 'verify', 'players', v_player_id,
          jsonb_build_object('verified', true, 'tag', p_tag));

  return jsonb_build_object(
    'ok', true,
    'player_id', v_player_id,
    'clan_id', v_clan_id);
end;
$$;

revoke execute on function link_verified_player(text, bigint, text) from public;
grant execute on function link_verified_player(text, bigint, text) to authenticated;

comment on function link_verified_player(text, bigint, text) is
  '077 - links a player tag to auth.uid() only with an HMAC proof from /api/verify '
  'that the in-game token was checked. Otherwise 032''s behaviour. The only write '
  'path to players from a session (R11).';


-- ---------------------------------------------------------------------------
-- 3. claim_platform_ownership() — the owner's email, checked here too

create or replace function claim_platform_ownership()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing integer;
  v_owner  text;
  v_email  text;
begin
  if auth.uid() is null then
    return false;
  end if;

  select value into v_owner from private.app_secrets where name = 'owner_email';
  select email into v_email from auth.users where id = auth.uid();
  if v_owner is null or v_email is null
     or lower(trim(v_email)) <> lower(trim(v_owner)) then
    return false;
  end if;

  select count(*) into existing
  from public.users
  where is_platform_admin and deleted_at is null;

  if existing > 0 then
    return false;
  end if;

  perform set_config('clanbridge.bootstrap', 'on', true);

  update public.users
  set is_platform_admin = true,
      status = 'approved',
      approved_at = now()
  where id = auth.uid();

  insert into public.audit_log (user_id, action, entity, entity_id, after)
  values (auth.uid(), 'claim-ownership', 'users', auth.uid(),
          jsonb_build_object('is_platform_admin', true));

  return true;
end;
$$;

revoke execute on function claim_platform_ownership() from public;
grant execute on function claim_platform_ownership() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. No control characters in a notification's link

alter table public.notifications drop constraint notifications_url_relative;
alter table public.notifications add constraint notifications_url_relative
  check (
    url like '/%'
    and url not like '//%'
    and strpos(url, chr(92)) = 0
    and url !~ '[[:cntrl:]]'
  ) not valid;
alter table public.notifications validate constraint notifications_url_relative;
